import http.server
import socket
import os
import sys

PORT = 5556
PUBLIC_DIR = os.path.dirname(os.path.abspath(__file__))

BLOCKED_PATTERNS = [
    ".db",
    ".py",
    ".pyc",
    "__pycache__",
    ".git",
    ".env",
    "backups",
    "notes.db",
]


class SecureHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def translate_path(self, path):
        fs_path = super().translate_path(path)
        rel = os.path.relpath(fs_path, PUBLIC_DIR)
        for pat in BLOCKED_PATTERNS:
            if pat in rel.split(os.sep) or pat in rel:
                self.send_error(404, "Not Found")
                return None
        return fs_path

    def do_GET(self):
        if self.translate_path(self.path) is None:
            return
        super().do_GET()

    def log_message(self, format, *args):
        print(f"  [{self.client_address[0]}] {args[0]} {args[1]} {args[2]}")


def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


if __name__ == "__main__":
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    server = http.server.HTTPServer(("0.0.0.0", PORT), SecureHandler)
    ip = get_local_ip()
    print()
    print("  Куратор запущен")
    print()
    print(f"  Телефон:  http://{ip}:{PORT}")
    print(f"  Компьютер: http://localhost:{PORT}")
    print()
    print("  Оба устройства в одной WiFi-сети")
    print("  Ctrl+C — остановить")
    print()
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Остановлен")
        server.server_close()
