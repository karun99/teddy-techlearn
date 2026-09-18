/**
 * Local verification harness — exercises the API layer in-process without Vercel.
 *   node scripts/verify.mjs
 */
import { Readable } from 'node:stream';

/* ---------- tiny req/res mocks for Vercel-style handlers ---------- */
function mockReq(body, method = 'POST', url = '/') {
  const req = Readable.from(JSON.stringify(body || {}));
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function mockRes() {
  const state = { statusCode: 200, body: '' };
  const res = {
    get statusCode() { return state.statusCode; },
    set statusCode(v) { state.statusCode = v; },
    get body() { return state.body; },
    setHeader() {},
    end(str) { state.body = str; },
    on() {},
    get jsonRef() { return state.body ? JSON.parse(state.body) : null; },
  };
  return res;
}

async function call(handler, payload, method = 'POST', url = '/') {
  const req = mockReq(payload, method, url);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { /* ignore */ }
  return { status: res.statusCode, json, body: res.body };
}

/* ---------- checks ---------- */
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function eq(name, actual, expected) {
  check(name, String(actual) === String(expected), `got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}

process.env.TEDDY_MEMORY_DIR = '/tmp/teddy-mem-test';

const chat = (await import('../api/chat.js')).default;
const quiz = (await import('../api/quiz.js')).default;
const notes = (await import('../api/notes.js')).default;
const rag = (await import('../api/rag.js')).default;
const health = (await import('../api/health.js')).default;
const learner = (await import('../api/learner.js')).default;
const config = (await import('../api/config.js')).default;
const { loadAllSubjects, syllabusStats } = await import('../api/_lib/syllabus.mjs');
const { retrieve } = await import('../api/_lib/rag.mjs');
const { isUsable, ordering } = await import('../api/_lib/router.mjs');

/* 1. syllabus integrity (FR-4xx) */
const subjects = loadAllSubjects();
eq('subjects count (FR-401)', subjects.length, 25);
const units = subjects.reduce((n, s) => n + s.units.length, 0);
eq('units count (FR-402)', units, 125);
const topics = subjects.reduce((n, s) => n + s.units.reduce((t, u) => t + u.topics.length, 0), 0);
eq('topics count (FR-402)', topics, 625);

/* 2. RAG retrieval (FR-501/502) */
const { hits } = retrieve('binary search algorithm with example', { limit: 4 });
check('RAG finds DSA topic docs', hits.some((h) => h.type === 'topic' && h.subjectId === 'dsa'), hits.slice(0, 3).map((h) => h.id).join(', '));
const { hits: h2 } = retrieve('describe machine learning neural networks', { limit: 3 });
check('RAG cross-subject retrieval', h2.some((h) => h.subjectId === 'ml' || h.subjectId === 'dl'), h2.slice(0, 3).map((h) => h.id).join(', '));
const { hits: h3 } = retrieve('AVL tree balancing rotations', { limit: 3 });
check('RAG glossary term found (FR-803)', h3.some((h) => h.type === 'glossary'), h3.slice(0, 3).map((h) => h.id).join(', '));

/* 3. chat endpoints (FR-6xx) */
let r = await call(chat, { message: 'explain binary search with an example', pageContext: { page: 'topic-dsa-u2-t1.html', subjectId: 'dsa', unit: 'Unit 2', topic: 'Topic 1' }, learnerId: 'test-learner-1' });
check('chat replies', r.status === 200 && r.json?.reply?.length > 20, `mode=${r.json?.mode} provider=${r.json?.provider}`);
check('chat gives source page', r.json?.topHit?.page || r.json?.sources?.length, JSON.stringify(r.json?.sources?.slice(0, 1)));

r = await call(chat, { message: 'what is the meaning of life according to this syllabus', pageContext: { subjectId: 'dsa' } });
check('chat refuses ungrounded (FR-505)', r.status === 200 && (r.json?.mode === 'refused'), `mode=${r.json?.mode}`);

/* 4. quiz generate + submit (FR-7xx) */
r = await call(quiz, { subject: 'dsa', unit: '1', count: 10, duration: 15, learnerId: 'test-learner-1' });
check('quiz generates', r.status === 200 && r.json?.questions?.length === 10 && !('correct' in r.json?.questions?.[0]), `kind=${r.json?.kind} qs=${r.json?.questions?.length}`);
const qids = r.json.questions.map((q) => q.id);
const answers = qids.map((id, i) => ({ id, selected: 0 })); // wrong on purpose (mostly)
r = await call(quiz, { submit: true, subject: 'dsa', unit: '1', quizId: r.json.quizId, answers, timeUsedMs: 120000, hintUsage: { count: 2 }, learnerId: 'test-learner-1' });
check('quiz scores', r.status === 200 && r.json?.total === 10 && typeof r.json?.score === 'number', `score=${r.json?.score}/10 acc=${r.json?.accuracy}`);
check('quiz persists + OI signal', r.json?.memorySaved === true && r.json?.oi?.level, `oi=${r.json?.oi?.value}`);
check('quiz exposes weak topics', Array.isArray(r.json?.weakTopics) && r.json?.weakTopics.length > 0);

/* 5. notes (FR-8xx) */
r = await call(notes, { subject: 'dsa', unit: '3', topic: '2', template: 'cornell' });
check('notes generate Cornell', r.status === 200 && r.json?.note?.content?.includes('Cornell'), `tpl=${r.json?.template}`);
r = await call(notes, { subject: 'dsa', unit: '3', topic: ' ', template: 'flashcards' });
check('notes flashcards', r.status === 200 && r.json?.note?.content?.includes('Q:'), 'Q/A cards');
r = await call(notes, { save: true, learnerId: 'test-learner-1', note: { title: 'DSA BinSearch', content: '# Notes', format: 'cornell', topicId: 'dsa-u2-t1' } });
check('notes save to graph', r.status === 200 && r.json?.saved === true && !!r.json?.note?.id, r.json?.note?.id);
r = await call(notes, { export: true, format: 'anki-csv', note: { title: 'x', content: 'Q: a\nA: b' } });
check('notes export anki-csv', r.status === 200 && r.json?.content?.includes('"a","b"'), r.json?.content);

/* 6. rag + health */
r = await call(rag, { query: 'hashing collision resolution', limit: 5 });
check('/api/rag returns hits', r.status === 200 && r.json?.hits?.length > 0);
r = await call(health, {}, 'GET');
check('/api/health ok', r.status === 200 && r.json?.status === 'ok' && r.json?.providers?.length >= 6, `providers=${r.json?.providers?.length} subjects=${r.json?.subjects?.length}`);
check('health lists 25 subjects', r.json?.subjects?.length === 25);

/* 7. per-user AI configuration (AI-CONFIG-1xx) */
r = await call(config, {}, 'GET', '/api/config?learnerId=cfg-user-1');
check('config defaults unconfigured', r.status === 200 && r.json?.configured === false, `configured=${r.json?.configured}`);
r = await call(config, { learnerId: 'cfg-user-1', config: { provider: 'gemini', model: 'gemini-1.5-flash', temperature: 0.7, maxTokens: 1500 } }, 'PUT');
check('config PUT saves', r.status === 200 && r.json?.saved && r.json?.config?.provider === 'gemini', JSON.stringify(r.json?.config));
r = await call(config, {}, 'GET', '/api/config?learnerId=cfg-user-1');
check('config GET returns stored', r.json?.configured === true && r.json?.config?.temperature === 0.7 && r.json?.config?.maxTokens === 1500, JSON.stringify(r.json?.config));
r = await call(config, { learnerId: 'cfg-user-1', config: { provider: 'openrouter', temperature: 0.7, apiKey: 'sk-should-never-persist' } }, 'PUT');
check('config rejects persisted API keys', r.status === 200 && !('apiKey' in r.json?.config), JSON.stringify(r.json?.config));
r = await call(config, {}, 'GET', '/api/config?learnerId=cfg-user-1');
check('config GET has no key leak', !JSON.stringify(r.json).includes('sk-should-never-persist'));
check('config advises byok providers', Array.isArray(r.json?.byokProviders) && !r.json?.byokProviders.includes('ollama'));
/* router BYOK unlock logic (env-independent) */
check('isUsable: BYOK unlocks matching provider', isUsable('openai', { apiKey: 'x', apiKeyFor: 'openai' }) === true);
check('isUsable: key does not unlock other providers', isUsable('openai', { apiKey: 'x', apiKeyFor: 'gemini' }) === false);
check('ordering includes keyed provider', ordering(['openai'], { apiKey: 'x', apiKeyFor: 'openai' }).some((p) => p.key === 'openai'));
r = await call(config, { learnerId: 'cfg-user-1' }, 'DELETE');
check('config DELETE resets', r.status === 200 && r.json?.cleared === true);
r = await call(config, {}, 'GET', '/api/config?learnerId=cfg-user-1');
check('config reset confirmed', r.json?.configured === false);

/* 8. erasure (FR-904) */
r = await call(learner, { learnerId: 'test-learner-1' }, 'DELETE');
check('learner erased', r.status === 200 && r.json?.erased === true);

/* report */
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
console.log('ALL CHECKS PASSED ✓ — ready for any LLM provider / deploy');