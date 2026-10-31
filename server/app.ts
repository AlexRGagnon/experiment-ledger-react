import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Problem } from '../shared/contracts.js';
import type { Ledger } from './store.js';

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new Problem('Use application/json.', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part as string);
    size += chunk.length;
    if (size <= 65536) chunks.push(chunk);
  }
  if (size > 65536) throw new Problem('Request exceeds 64 KiB.', 413);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Problem('Invalid JSON.');
  }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
export function createApp(ledger: Ledger, staticRoot: string) {
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = error instanceof Problem;
      if (!known)
        console.error(
          'Ledger request failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
      json(res, known ? error.status : 500, {
        error: known ? error.message : 'Internal server error.',
      });
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const addr = server.address(),
      port = typeof addr === 'object' && addr ? addr.port : 0;
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      throw new Problem('Invalid Host header.', 403);
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      throw new Problem('Cross-origin requests are not allowed.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site')
      throw new Problem('Cross-site requests are not allowed.', 403);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      throw new Problem('Invalid URL.');
    }
    if (url.origin !== `http://${host}`) throw new Problem('Invalid request origin.', 403);
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST' && method !== 'PATCH')
      throw new Problem('Method not allowed.', 405);
    if (method !== 'GET' && req.headers['x-ledger-client'] !== '1')
      throw new Problem('Missing request guard.', 403);
    if (method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/runs') {
      if (method === 'GET') {
        json(res, 200, ledger.list(url.searchParams.get('q') ?? ''));
        return;
      }
      if (method === 'POST') {
        const imported = ledger.import(await body(req));
        json(res, imported.created ? 201 : 200, imported);
        return;
      }
    }
    const match = /^\/api\/runs\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (match && match[1]) {
      if (method === 'GET') {
        json(res, 200, { run: ledger.get(match[1]) });
        return;
      }
      if (method === 'PATCH') {
        json(res, 200, { run: ledger.updateNotes(match[1], await body(req)) });
        return;
      }
    }
    if (
      method === 'GET' &&
      (url.pathname === '/' || /^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(url.pathname))
    ) {
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      let data: Buffer;
      try {
        data = await readFile(join(staticRoot, path));
      } catch {
        throw new Problem('Asset not found.', 404);
      }
      const type = path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
      return;
    }
    throw new Problem('Not found.', 404);
  }
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
