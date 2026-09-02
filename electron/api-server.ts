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
  let filePath = path.join(DIST_DIR, pathOnly === '/' ? 'index.html' : pathOnly);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
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

export function startApiServer(): Promise<ApiServerHandle> {
  const apiMiddleware = createPiApiMiddleware();
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      const pathname = new URL(url, 'http://localhost').pathname;
      // API routes first; everything else falls back to static files.
      apiMiddleware(req, res, () => serveStatic(pathname, res));
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}
