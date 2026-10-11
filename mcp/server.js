#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = path.basename(ROOT) || 'repository';

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.next', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.turbo', 'coverage', '.idea', '.vscode']);
const TEXT_EXT = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.md', '.markdown', '.txt', '.rst', '.yml', '.yaml', '.toml', '.cfg',
  '.ini', '.html', '.css', '.sql', '.sh']);
const MAX_READ = 200000;
const MAX_SCAN = 600000;

function walk(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), base, out);
    } else if (e.isFile()) {
      out.push(path.relative(base, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

function allFiles() { return walk(ROOT, ROOT, []).sort(); }

function readManifest() {
  const info = { name: SERVER_NAME, version: null, description: null };
  for (const cand of ['package.json', 'frontend/package.json', 'backend/package.json']) {
    const p = path.join(ROOT, cand);
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        info.name = data.name || info.name;
        info.version = data.version || null;
        info.description = data.description || null;
        return info;
      } catch (e) {}
    }
  }
  return info;
}

function languages(files) {
  const counts = {};
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (TEXT_EXT.has(ext)) counts[ext] = (counts[ext] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8));
}

function safePath(rel) {
  if (!rel) return null;
  const p = path.resolve(ROOT, rel);
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return null;
  return p;
}

function isText(rel) { return TEXT_EXT.has(path.extname(rel).toLowerCase()); }

function infoText() {
  const files = allFiles();
  const m = readManifest();
  return JSON.stringify({
    name: m.name, version: m.version, description: m.description,
    files: files.length, languages: languages(files),
    docs: files.filter((f) => f.startsWith('docs/') || f.startsWith('documentation/')).slice(0, 20),
  }, null, 2);
}

function listText(arg) {
  let files = allFiles();
  if (arg) {
    const a = String(arg).toLowerCase();
    files = files.filter((f) => f.toLowerCase().includes(a));
  }
  const total = files.length;
  return files.slice(0, 200).join('\n') + (total > 200 ? `\n... (${total} files total)` : '');
}

function readText(arg) {
  const rel = String(arg || '');
  const p = safePath(rel);
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return `File not found: ${rel}`;
  try {
    const raw = fs.readFileSync(p).subarray(0, MAX_READ + 1);
    let text = raw.toString('utf8');
    if (raw.length > MAX_READ) text += '\n... (truncated)';
    return text;
  } catch (e) { return `Cannot read ${rel}: ${e.message}`; }
}

function searchText(arg) {
  const query = String(arg || '');
  if (query.length < 2) return 'Provide a search string of at least 2 characters.';
  const needle = query.toLowerCase();
  const hits = [];
  for (const rel of allFiles()) {
    if (hits.length >= 60 || !isText(rel)) continue;
    const full = path.join(ROOT, rel);
    let stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (stat.size > MAX_SCAN) continue;
    let lines;
    try { lines = fs.readFileSync(full, 'utf8').split('\n'); } catch (e) { continue; }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        if (hits.length >= 60) break;
      }
    }
  }
  return hits.length ? hits.join('\n') : `No matches for ${JSON.stringify(query)}`;
}

function healthText() {
  return JSON.stringify({ status: 'ok', server: SERVER_NAME, protocol: PROTOCOL_VERSION, root: ROOT, files: allFiles().length }, null, 2);
}

const TOOLS = [
  { name: 'repo_info', description: 'Project metadata: manifest name/version/description, file count, languages and docs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_files', description: 'List repository files, optionally filtered by a substring.', inputSchema: { type: 'object', properties: { filter: { type: 'string' } }, additionalProperties: false } },
  { name: 'read_file', description: 'Return the text of a repository file (path is confined to the repository).', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'search', description: 'Case-insensitive substring search across text files, returning path:line matches.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'health', description: 'Server health and repository availability check.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

function dispatch(name, args) {
  args = args || {};
  if (name === 'repo_info') return infoText();
  if (name === 'list_files') return listText(args.filter);
  if (name === 'read_file') return readText(args.path);
  if (name === 'search') return searchText(args.query);
  if (name === 'health') return healthText();
  return null;
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function handle(msg) {
  const id = msg.id === undefined ? null : msg.id;
  const method = msg.method;
  const params = msg.params || {};
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: readManifest().version || '1.0.0' },
    } });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const out = dispatch(params.name, params.arguments);
    if (out === null) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: out }] } });
  }
  if (id === null) return;
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch (e) {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try { handle(msg); } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id === undefined ? null : msg.id, error: { code: -32603, message: `Internal error: ${e.message}` } });
  }
});
rl.on('close', () => process.exit(0));
