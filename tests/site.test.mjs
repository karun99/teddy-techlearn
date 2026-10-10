import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("index.html exists and is a non-trivial HTML document", async () => {
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  assert.match(html, /<html/i);
  assert.ok(html.length > 100, "index.html looks empty");
});

test("package.json declares the site name", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.name, "teddy-techlearn");
});
