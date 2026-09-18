import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllSubjects } from './syllabus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are',
  'what', 'which', 'how', 'why', 'who', 'when', 'can', 'you', 'me', 'my', 'i', 'it',
  'this', 'that', 'these', 'those', 'please', 'explain', 'about', 'from', 'by',
  'be', 'have', 'has', 'not', 'no', 'as', 'at', 'into', 'over', 'would', 'could',
  'should', 'do', 'does', 'did', 'was', 'were', 'will', 'say', 'says', 'tell',
]);

let _corpus = null;

export function tokenize(text) {
  const s = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.split(/\s+/).filter((w) => w && w.length > 1 && !STOPWORDS.has(w));
}

function termFreq(docTokens) {
  const m = new Map();
  for (const t of docTokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function parseGlossary() {
  const file = join(__dirname, '..', '..', 'glossary.html');
  const entries = [];
  try {
    const html = readFileSync(file, 'utf8');
    const re = /\{\s*t:\s*'((?:[^'\\]|\\.)*)',\s*c:\s*'((?:[^'\\]|\\.)*)',\s*d:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
    let m;
    while ((m = re.exec(html))) {
      entries.push({
        id: 'glossary-' + m[1].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-'),
        type: 'glossary',
        title: m[1],
        subject: m[2],
        page: 'glossary.html',
        text: `${m[1]}: ${m[3]}`,
      });
    }
  } catch {
    /* glossary parse is best-effort */
  }
  return entries;
}

function flattenTopicContent(t) {
  const parts = [t.title];
  for (const c of t.content || []) {
    if (c.text) parts.push(c.text);
    if (c.items && Array.isArray(c.items)) parts.push(c.items.join('. '));
    if (c.title) parts.push(c.title);
  }
  return parts.join('. ');
}

function buildCorpus() {
  const subjects = loadAllSubjects();
  const docs = [];

  for (const s of subjects) {
    docs.push({
      id: `subject-${s.id}`,
      type: 'subject',
      title: `${s.title} (${s.code})`,
      subjectId: s.id,
      subjectTitle: s.title,
      unitTitle: null,
      page: `subject-${s.id}.html`,
      text: `${s.title} ${s.subtitle || ''} ${(s.objectives || []).join('. ')} ${(s.outcomes || []).join('. ')}`,
    });

    for (const u of s.units || []) {
      docs.push({
        id: `unit-${s.id}-u${u.id}`,
        type: 'unit',
        title: `${s.title} — Unit ${u.id}: ${u.title}`,
        subjectId: s.id,
        subjectTitle: s.title,
        unitTitle: u.title,
        page: `subject-${s.id}.html`,
        text: `Unit ${u.id}: ${u.title}. ${u.summary || ''} ${(u.topics || []).map((t) => t.title).join('. ')}`,
      });

      for (const t of u.topics || []) {
        docs.push({
          id: `topic-${s.id}-u${u.id}-t${t.n}`,
          type: 'topic',
          title: `${s.title} · ${u.title} · ${t.n} ${t.title}`,
          subjectId: s.id,
          subjectTitle: s.title,
          unitTitle: u.title,
          page: `topic-${s.id}-u${u.id}-t${t.n}.html`,
          text: flattenTopicContent(t),
        });
      }

      for (const q of u.pyq || []) {
        docs.push({
          id: `pyq-${s.id}-u${u.id}-` + q.q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 48),
          type: 'pyq',
          title: `${s.title} · Unit ${u.id} PYQ`,
          subjectId: s.id,
          subjectTitle: s.title,
          unitTitle: u.title,
          page: `subject-${s.id}-pyq-u${u.id}.html`,
          text: `${q.q} Marks: ${q.marks || ''}. Type: ${q.type || ''}.`,
        });
      }
    }
  }

  docs.push(...parseGlossary());

  // Pre-tokenize + precompute doc lengths for BM25.
  const indexed = docs.map((d) => {
    const tokens = tokenize(d.text);
    return { doc: d, tokens, tf: termFreq(tokens) };
  });

  return { docs: indexed, avgLen: avgDocLen(indexed), totalDocs: indexed.length };
}

function avgDocLen(indexed) {
  if (!indexed.length) return 1;
  return indexed.reduce((n, x) => n + x.tokens.length, 0) / indexed.length;
}

function idf(n, N) {
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

export function getCorpus() {
  if (!_corpus) _corpus = buildCorpus();
  return _corpus;
}

const K1 = 1.2;
const B = 0.75;

/** BM25 retrieval. Returns ranked hits with scores. */
export function retrieve(query, { limit = 5, subjectId, minScore = 0 } = {}) {
  const { docs, avgLen, totalDocs } = getCorpus();
  const qTokens = tokenize(query);
  if (!qTokens.length) return { hits: [], queryTokens: [] };

  // document frequency per token
  const df = new Map();
  for (const t of qTokens) {
    let n = 0;
    for (const x of docs) if (x.tf.has(t)) n += 1;
    df.set(t, n);
  }

  const scores = [];
  for (const x of docs) {
    if (subjectId && x.doc.subjectId !== subjectId) continue;
    const len = x.tokens.length;
    let score = 0;
    for (const t of qTokens) {
      const tf = x.tf.get(t) || 0;
      if (!tf) continue;
      const w = idf(df.get(t), totalDocs);
      score += w * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (len / avgLen))));
    }
    // phrase bonus: full query substring present in raw doc text
    const lower = String(query).toLowerCase();
    if (x.tokens.length && lower && x.doc.text.toLowerCase().includes(lower)) score += 2;
    if (score > 0) scores.push({ score, doc: x.doc, tf: x.tf });
  }

  scores.sort((a, b) => b.score - a.score);
  const hits = scores
    .filter((h) => h.score >= minScore)
    .slice(0, limit)
    .map((h) => ({ score: round2(h.score), ...present(h) }));
  return { hits, queryTokens: qTokens };
}

function present(h) {
  const d = h.doc;
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    subjectId: d.subjectId,
    subjectTitle: d.subjectTitle,
    unitTitle: d.unitTitle,
    page: d.page,
    snippets: d.text.slice(0, 600),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** True when enough grounding was found (for FR-505 refusal path). */
export function isGrounded(hits, minScore = 0.4) {
  return hits.some((h) => h.score >= minScore);
}

export function groundingContext(hits, maxChars = 6000) {
  let out = '';
  for (const h of hits) {
    const block = `[SOURCE: ${h.page} — ${h.title}]\n${h.snippets}\n\n`;
    if ((out + block).length > maxChars) break;
    out += block;
  }
  return out.trim();
}