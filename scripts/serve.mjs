/**
 * Local dev server — static TechLearn site + Teddy /api functions.
 * Run:  node scripts/serve.mjs   (then open http://localhost:8787/index.html)
 * Mirrors the Vercel deployment so you can smoke-test the widget locally.
 */
import { createServer } from 'node:http';
import { readFile, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 8787;

const handlers = {
  'GET /api/health': (await import('../api/health.js')).default,
  'POST /api/chat': (await import('../api/chat.js')).default,
  'POST /api/quiz': (await import('../api/quiz.js')).default,
  'POST /api/notes': (await import('../api/notes.js')).default,
  'POST /api/rag': (await import('../api/rag.js')).default,
  'DELETE /api/learner': (await import('../api/learner.js')).default,
  'GET /api/config': (await import('../api/config.js')).default,
  'PUT /api/config': (await import('../api/config.js')).default,
  'POST /api/config': (await import('../api/config.js')).default,
  'DELETE /api/config': (await import('../api/config.js')).default,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function svc(req, res) {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const h = handlers[key];
  if (h) return h(req, res);
  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: 'no route ' + key }));
}

function stat(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  // mimic cleanUrls: /foo -> foo.html when the .html exists
  let file = join(ROOT, normalize(p));
  if (!existsSync(file) && !extname(file)) {
    const cand = join(ROOT, normalize(p) + '.html');
    if (existsSync(cand)) file = cand;
  }
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (existsSync(file) && file.split('/').pop().includes('.')) {
    return readFile(file, (err, data) => {
      if (err) { res.statusCode = 500; return res.end(String(err)); }
      res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  }
  res.statusCode = 404;
  res.end('Not found');
}

createServer((req, res) => (req.url.startsWith('/api/') ? svc(req, res) : stat(req, res)))
  .listen(PORT, () => console.log(`🧸 Teddy × TechLearn → http://localhost:${PORT}/index.html`));