#!/usr/bin/env python3
"""
No-cache dev server for local 3D development.

Why this exists
---------------
Every script in this project is loaded with a plain <script src="..."> tag, so
the browser is free to reuse a cached copy for as long as it likes. While
iterating on the 3D code that produced rounds and rounds of "my fix had no
effect" - the page kept running a stale mapterhorn_terrain.js / index.js and
the console reported line numbers and values from an older file. Reloading with
DevTools' "Disable cache" ticked works, but only while DevTools is open.

This server sends `Cache-Control: no-store` for every response, so a normal
reload always picks up the current files and you can keep DevTools closed.

Usage
-----
    python serve_dev.py                 # http://localhost:8000/3dmodelsosm/
    python serve_dev.py 9000            # pick another port
    PORT=9000 python serve_dev.py       # same thing, POSIX style

It serves the PARENT directory, so the app is reachable under the
`/3dmodelsosm/` prefix - the path baked into the code (model URLs such as
/3dmodelsosm/src/models/w_bus_stop.glb). Opening the bare `/` or `/index.html`
redirects into that prefix automatically.

Nothing here is for production: it binds all interfaces, serves the parent
folder, and disables caching.
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(PROJECT_DIR)
PROJECT_NAME = os.path.basename(PROJECT_DIR)

# The app also uses ES modules (type="module"), which browsers refuse to load
# over file:// - another reason to go through a real server.
SUFFIXES = [
    ".html", ".js", ".mjs", ".json", ".css", ".geojson", ".csv",
    ".glb", ".gltf", ".bin", ".jpg", ".jpeg", ".png", ".svg", ".webp",
    ".ico", ".txt", ".wasm", ".xml",
]


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Serves the parent directory with caching switched off."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PARENT_DIR, **kwargs)

    def do_GET(self):
        """Send anything outside the project prefix into it."""
        if not self.path.startswith("/" + PROJECT_NAME):
            self.send_response(302)
            self.send_header("Location", "/" + PROJECT_NAME + self.path)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()

    def do_HEAD(self):
        if not self.path.startswith("/" + PROJECT_NAME):
            self.send_response(302)
            self.send_header("Location", "/" + PROJECT_NAME + self.path)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_HEAD()

    def guess_type(self, path):
        # SimpleHTTPRequestHandler does not always know our data formats; being
        # explicit avoids the browser trying to sniff a .glb as text.
        ext = os.path.splitext(path)[1].lower()
        if ext in SUFFIXES:
            for guess, mimetype in self.extensions_map.items():
                if guess == ext:
                    return mimetype
        return super().guess_type(path)

    def end_headers(self):
        # Applied to the 302 redirects above as well.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler)
    url = "http://localhost:%d/%s/" % (port, PROJECT_NAME)
    print("Serving %s" % PARENT_DIR)
    print("Open:      %s" % url)
    print("Caching:   disabled (no-store)")
    print("Stop:      Ctrl+C")
    print("")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
