#!/usr/bin/env python3
"""
Localdrop - Local Network Server
Serves the Localdrop web app over local Wi-Fi with optional HTTPS for mobile browsers.
"""

import os
import sys
import socket
import ssl
import subprocess
from urllib.parse import unquote, urlsplit
import posixpath
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

def ensure_ssl_cert(local_ip, cert_file='cert.pem', key_file='key.pem'):
    """Generates a local certificate whose SAN matches the LAN address."""
    cert_matches_ip = False
    if os.path.exists(cert_file) and os.path.exists(key_file):
        try:
            cert_info = subprocess.run(
                ['openssl', 'x509', '-in', cert_file, '-noout', '-ext', 'subjectAltName'],
                check=True, capture_output=True, text=True
            )
            cert_matches_ip = f'IPAddress:{local_ip}' in cert_info.stdout.replace(' ', '')
        except Exception:
            cert_matches_ip = False

    if not cert_matches_ip:
        print("🔐 Generating self-signed SSL certificate for local Wi-Fi HTTPS...")
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', key_file, '-out', cert_file,
            '-days', '365', '-nodes',
            '-subj', '/CN=localhost',
            '-addext', f'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{local_ip}'
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.chmod(key_file, 0o600)
            print("✓ Generated cert.pem and key.pem")
        except Exception as e:
            print(f"⚠ Could not generate SSL certificate: {e}")
            return False
    return True

class UniRequestHandler(SimpleHTTPRequestHandler):
    PUBLIC_FILES = {
        'index.html', 'manifest.json', 'sw.js', 'css/styles.css', 'icons/icon.svg',
        'js/app.js', 'js/crypto.js', 'js/file-streamer.js', 'js/jsqr.min.js',
        'js/qr-codec.js', 'js/sdp-compress.js', 'js/ui.js', 'js/webrtc.js'
    }

    def _allowed_asset(self):
        path = posixpath.normpath(unquote(urlsplit(self.path).path).lstrip('/'))
        if path in ('', '.'):
            path = 'index.html'
        return path in self.PUBLIC_FILES

    def do_GET(self):
        if not self._allowed_asset():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if not self._allowed_asset():
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        # Avoid stale app-shell assets during development.
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
        if ensure_ssl_cert(local_ip):
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            protocol = "https"
        else:
            print("Falling back to standard HTTP.")

    print("=" * 60)
    print("↗ LOCALDROP - LOCAL P2P SERVER")
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
        print("\nStopping Localdrop server.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
