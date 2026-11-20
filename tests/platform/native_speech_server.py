"""A stand-in for a speech.cpp server the app reads aloud with, on this PC only.

It answers what native/tts/src/client.rs asks: `/health`, `/v1/models` and
`POST /v1/audio/speech` with `response_format: "pcm"`, which returns signed 16-bit mono
PCM at 48 kHz (`X-Sample-Rate`). No model runs; the audio is a tone. It was
`FixtureServer` of tests/voice/ui_entry_acceptance.py, which went with the Python
backend (#285).
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import struct
from threading import Thread


class SpeechServerFixture:
    def __init__(self):
        self.requests = []

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def do_GET(self):
                body = b'{"status":"ok"}' if self.path == '/health' else b'{"data":[]}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path != '/v1/audio/speech' or data.get('response_format') != 'pcm':
                    self.send_error(400)
                    return
                owner.requests.append(data)
                # Three seconds of a 440 Hz tone whose loudness steps up and down.
                pcm = bytearray()
                for i in range(48000 * 3):
                    t = i / 48000
                    amp = (0, .5, .2, .8, .1, .6, .3)[int(t * 7) % 7]
                    pcm.extend(struct.pack('<h', round(12000 * amp * math.sin(2 * math.pi * 440 * t))))
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/pcm')
                    self.send_header('X-Sample-Rate', '48000')
                    self.send_header('Content-Length', str(len(pcm)))
                    self.end_headers()
                    self.wfile.write(pcm)
                except (OSError, ConnectionError):
                    pass  # The app stopped reading (a stop or a mute).

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = Thread(target=lambda: self.server.serve_forever(.01), daemon=True)
        self.thread.start()
        return self

    @property
    def url(self):
        return f'http://127.0.0.1:{self.server.server_port}'

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
