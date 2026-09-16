#!/usr/bin/env python3
"""
Universal Share - Local Network Server
Serves Universal Share over local Wi-Fi with optional HTTPS for mobile camera access.
"""

import os
import sys
import socket
import ssl
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT_HTTP = 8080
PORT_HTTPS = 8443

def get_local_ip():
    """Detects the primary Wi-Fi / LAN IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Connect to an arbitrary address to find default route interface
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def ensure_ssl_cert(cert_file='cert.pem', key_file='key.pem'):
    """Generates a self-signed SSL certificate if one does not exist."""
    if not (os.path.exists(cert_file) and os.path.exists(key_file)):
        print("🔐 Generating self-signed SSL certificate for local Wi-Fi HTTPS...")
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', key_file, '-out', cert_file,
            '-days', '365', '-nodes',
            '-subj', '/CN=localhost'
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("✓ Generated cert.pem and key.pem")
        except Exception as e:
            print(f"⚠ Could not generate SSL certificate: {e}")
            return False
    return True

class UniRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and Cache-Control headers for PWA
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def run_server():
    use_https = '--https' in sys.argv or '-s' in sys.argv
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else (PORT_HTTPS if use_https else PORT_HTTP)
    local_ip = get_local_ip()

    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, UniRequestHandler)

    protocol = "http"
    if use_https:
        if ensure_ssl_cert():
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            protocol = "https"
        else:
            print("Falling back to standard HTTP.")

    print("=" * 60)
    print("⚡ UNIVERSAL SHARE - LOCAL P2P SERVER")
    print("=" * 60)
    print(f"• Local (Mac):    {protocol}://localhost:{port}")
    print(f"• Phone / LAN:    {protocol}://{local_ip}:{port}")
    print("=" * 60)
    print("💡 Tip for iOS / Android:")
    print(f"   Connect your phone to the SAME Wi-Fi or Mac Hotspot,")
    print(f"   then open: {protocol}://{local_ip}:{port} in Safari or Chrome.")
    if use_https:
        print("   (Accept the self-signed certificate warning on first load)")
    else:
        print("   Run with '--https' to enable camera QR scanning on remote phones:")
        print("   python3 serve.py --https")
    print("=" * 60)
    print("Press Ctrl+C to stop.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Universal Share server.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
