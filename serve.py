#!/usr/bin/env python3
"""
Serve dr.html on localhost and local network.
Usage: python3 serve.py [port]
Default port: 8080
"""

import http.server
import socketserver
import sys
import socket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=".", **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        local_ip = get_local_ip()
        print()
        print("  Daily Record – local server")
        print()
        print("  Local:   http://localhost:{}/".format(PORT))
        print("  Network: http://{}:{}/".format(local_ip, PORT))
        print()
        print("  Stop with Ctrl+C")
        print()
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
