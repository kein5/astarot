"""A translation provider the native GUI tests point the app at (LM Studio's API on 127.0.0.1).

It was part of test_native_realtime.py, which went with the Python backend in 0.6.0 (#285).
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
import time


class TranslationFixture:
    """The production LMStudio provider talks to this deterministic HTTP peer."""

    def __init__(self, translations=None):
        self.translations = translations

    def __enter__(self):
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def respond(self, value):
                data = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                assert self.path == "/v1/models"
                self.respond({"data": [{"id": "caption-integration-fixture", "object": "model"}]})

            def do_POST(self):
                assert self.path == "/v1/chat/completions"
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                assert request["model"] == "caption-integration-fixture"
                owner.requests.append({"time_ns": time.monotonic_ns(), "message_count": len(request["messages"])})
                self.respond({"id": "fixture", "object": "chat.completion", "created": 0,
                              "model": request["model"], "choices": [{"index": 0, "finish_reason": "stop",
                              "message": {"role": "assistant", "content": (
                                  owner.translations[(len(owner.requests) - 1) % len(owner.translations)]
                                  if owner.translations else "Integration translation " + str(len(owner.requests)))}}]})

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=lambda: self.server.serve_forever(0.02), daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1"
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
