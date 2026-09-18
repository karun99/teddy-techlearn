/**
 * Small helpers for Vercel serverless handlers.
 */

export function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export function json(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  setCors(res);
  res.end(JSON.stringify(payload));
}

export function html(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function cors(res) {
  setCors(res);
  res.statusCode = 204;
  res.end();
}

export function error(res, message, status = 400, extra = {}) {
  return json(res, { ok: false, error: message, ...extra }, status);
}

export function ok(res, data, status = 200) {
  return json(res, { ok: true, ...data }, status);
}

export function requireStr(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}