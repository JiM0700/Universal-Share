#!/usr/bin/env python3
"""
Universal Share - Asset and Server Verification Script
Validates file structure, content integrity, and local HTTP serving.
"""

import os
import sys
import time
import socket
import urllib.request
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED_FILES = [
    'index.html',
    'manifest.json',
    'sw.js',
    'serve.py',
    'README.md',
    'css/styles.css',
    'js/crypto.js',
    'js/sdp-compress.js',
    'js/jsqr.min.js',
    'js/qr-codec.js',
    'js/webrtc.js',
    'js/file-streamer.js',
    'js/ui.js',
    'js/app.js',
    'icons/icon.svg',
    'tests/test_suite.html'
]

def check_files():
    print("1. Checking required files existence...")
    all_ok = True
    for rel_path in REQUIRED_FILES:
        full_path = os.path.join(BASE_DIR, rel_path)
        if os.path.exists(full_path):
            size = os.path.getsize(full_path)
            print(f"  ✓ {rel_path} ({size} bytes)")
        else:
            print(f"  ✗ MISSING: {rel_path}")
            all_ok = False
    return all_ok

def verify_http_server():
    print("\n2. Testing HTTP server asset delivery...")
    port = 8899

    class TestHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)

    server = HTTPServer(('127.0.0.1', port), TestHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    time.sleep(0.5)

    test_urls = [
        '/',
        '/index.html',
        '/manifest.json',
        '/sw.js',
        '/css/styles.css',
        '/js/app.js',
        '/icons/icon.svg',
        '/tests/test_suite.html'
    ]

    all_passed = True
    for path in test_urls:
        url = f"http://127.0.0.1:{port}{path}"
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=3) as resp:
                status = resp.status
                content_len = len(resp.read())
                content_type = resp.headers.get('Content-Type')
                if status == 200 and content_len > 0:
                    print(f"  ✓ GET {path} -> {status} OK ({content_len} bytes, {content_type})")
                else:
                    print(f"  ✗ GET {path} -> Failed ({status})")
                    all_passed = False
        except Exception as e:
            print(f"  ✗ GET {path} -> Error: {e}")
            all_passed = False

    server.shutdown()
    server.server_close()
    return all_passed

def main():
    print("=" * 60)
    print("⚡ UNIVERSAL SHARE - AUTOMATED INTEGRITY CHECK")
    print("=" * 60)

    files_ok = check_files()
    http_ok = verify_http_server()

    print("\n" + "=" * 60)
    if files_ok and http_ok:
        print("🎉 ALL INTEGRITY AND ASSET CHECKS PASSED!")
        print("=" * 60)
        sys.exit(0)
    else:
        print("⚠ SOME CHECKS FAILED.")
        print("=" * 60)
        sys.exit(1)

if __name__ == '__main__':
    main()
