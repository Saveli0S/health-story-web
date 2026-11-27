"""Serve the prototype and its on-device recognition engines, e.g. python3 serve_preview.py --bind 127.0.0.1."""
import argparse
from sync_store import SyncStore
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PAGES = {"sw.js", "index.html", "iphone.html", "styles.css", "demo-data.js", "records.js", "journal.js",
         "treatment.js", "recognition.js", "visit-import.js", "intake.js", "app.js"}


class PreviewHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def route_sync(self):
        if not urlsplit(self.path).path.startswith("/sync/"):
            return False
        if self.server.sync_store is None:
            self.send_error(404)
        else:
            self.server.sync_store.handle(self)
        return True

    def route_chatgpt(self):
        path = urlsplit(self.path).path
        if not (path.startswith("/chatgpt/") or path == "/auth/callback"):
            return False
        if self.server.chatgpt is None:
            self.send_error(404)
        else:
            self.server.chatgpt.handle(self)
        return True

    def do_POST(self):
        if not self.route_chatgpt():
            self.send_error(404)

    def do_GET(self):
        if not self.route_chatgpt() and not self.route_sync():
            super().do_GET()

    def do_PUT(self):
        if not self.route_sync():
            self.send_error(404)

    do_DELETE = do_PUT

    def send_head(self):
        path = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        resolved = (ROOT / path).resolve()
        if not resolved.is_file() or not (path in PAGES or resolved.is_relative_to(ROOT / "assets")):
            self.send_error(404)
            return None
        return super().send_head()

    def guess_type(self, path):
        if path.endswith(".mjs"):
            return "text/javascript"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *_args):
        pass


class PreviewServer(ThreadingHTTPServer):
    request_queue_size = 128


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8764)
    parser.add_argument("--sync-store", type=Path, help="Private SQLite file for encrypted device sync, outside the served directory")
    parser.add_argument("--chatgpt", action="store_true", help="Enable personal ChatGPT sign-in on the local Mac")
    args = parser.parse_args()
    if args.chatgpt and args.bind != "127.0.0.1":
        parser.error("ChatGPT sign-in requires a loopback-only server")
    if args.sync_store and args.sync_store.resolve().is_relative_to(ROOT):
        parser.error("Keep the sync database outside the served directory")
    handler = partial(PreviewHandler, directory=str(ROOT))
    server = PreviewServer((args.bind, args.port), handler)
    server.sync_store = SyncStore(args.sync_store) if args.sync_store else None
    server.chatgpt = None
    if args.chatgpt:
        from chatgpt_local import ChatGPT
        folder = Path.home() / "Library/Application Support/HealthStory/chatgpt"
        server.chatgpt = ChatGPT(f"http://127.0.0.1:{server.server_port}", folder)
    server.serve_forever()
