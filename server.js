#!/usr/bin/env node
/**
 * Minimal zero-dependency static server for local development / offline preview
 * of the Teddy TechLearn site. The production deployment is served by Vercel
 * from the repository root; this entry point simply lets the site run anywhere.
 *
 *   node server.js            # http://localhost:8080
 *   PORT=3000 node server.js
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Teddy TechLearn preview: http://localhost:${PORT}`);
});
