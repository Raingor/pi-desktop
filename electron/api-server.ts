// Local HTTP API server for the packaged Electron app.
//
// The web frontend fetches data from relative `/api/pi/*` URLs. In dev that
// hits the Vite middleware plugin; in a packaged build there is no Vite, so
// this server serves both the static `dist/` bundle AND the same /api/pi/*
// routes by delegating to the shared route table in server/api-routes.ts.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPiApiMiddleware } from '../server/api-routes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/ sits next to dist-electron/ (packaged: app.asar/dist/...)
const DIST_DIR = path.join(__dirname, '../../dist');

// ─── Helpers ─────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// ─── Static file serving (dist bundle) ───────────────────

function serveStatic(pathOnly: string, res: http.ServerResponse): void {
  // SPA fallback: unknown non-asset paths serve index.html
  const indexPath = path.join(DIST_DIR, 'index.html');
  let filePath = path.resolve(DIST_DIR, `.${pathOnly === '/' ? '/index.html' : pathOnly}`);
  // Defence in depth. Callers pass `new URL(...).pathname`, which already
  // collapses `..` segments, but that is an invariant of the caller rather
  // than of this function — assert containment here so the bundle directory
  // stays the boundary no matter who calls it.
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
    filePath = indexPath;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = indexPath;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

// ─── Server lifecycle ────────────────────────────────────

export interface ApiServerHandle {
  server: http.Server;
  port: number;
  url: string;
}

// The renderer is served over http://127.0.0.1:<port>, so the port is part of
// the page's origin — and localStorage is origin-scoped. Listening on port 0
// therefore threw away every stored preference (interface style, zoom, font
// size, language, currency, sidebar width, last chat model, speed-test
// results, tool-panel state) on each launch. Prefer a fixed port and only
// walk upward when something else already holds it.
const PREFERRED_PORT = 51799;
const PORT_ATTEMPTS = 24;

export function startApiServer(): Promise<ApiServerHandle> {
  const apiMiddleware = createPiApiMiddleware();

  const listenOn = (port: number): Promise<ApiServerHandle> =>
    new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = req.url ?? '/';
        const pathname = new URL(url, 'http://localhost').pathname;
        // API routes first; everything else falls back to static files.
        apiMiddleware(req, res, () => serveStatic(pathname, res));
      });

      const onError = (error: NodeJS.ErrnoException) => {
        server.close();
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const actual = typeof addr === 'object' && addr ? addr.port : port;
        resolve({ server, port: actual, url: `http://127.0.0.1:${actual}` });
      });
    });

  const attempt = (offset: number): Promise<ApiServerHandle> =>
    listenOn(PREFERRED_PORT + offset).catch((error: NodeJS.ErrnoException) => {
      const busy = error.code === 'EADDRINUSE' || error.code === 'EACCES';
      if (!busy) throw error;
      // Out of candidates: fall back to an ephemeral port so the app still
      // starts. Preferences reset in that case, which beats not launching.
      if (offset + 1 >= PORT_ATTEMPTS) return listenOn(0);
      return attempt(offset + 1);
    });

  return attempt(0);
}
