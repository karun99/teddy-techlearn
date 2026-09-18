/**
 * GET /api/health — diagnostics: providers, memory backend, corpus stats.
 */
import { cors, ok } from './_lib/http.mjs';
import { listAvailableProviders } from './_lib/router.mjs';
import { memoryStatus } from './_lib/memory.mjs';
import { syllabusStats } from './_lib/syllabus.mjs';
import { oiStatus } from './_lib/oi.mjs';
import { getCorpus } from './_lib/rag.mjs';
import { loadAllSubjects } from './_lib/syllabus.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'GET') return ok(res, { ok: true, message: 'POST supported for chat/quiz/notes/rag' });

  let corpusCount = 0;
  try { corpusCount = getCorpus().docs.length; } catch { /* ignore */ }

  const subjects = loadAllSubjects().map((s) => ({ id: s.id, title: s.short || s.title, code: s.code }));

  return ok(res, {
    service: 'teddy-x-techlearn',
    status: 'ok',
    time: new Date().toISOString(),
    syllabus: syllabusStats(),
    subjects,
    rag: { documents: corpusCount },
    providers: listAvailableProviders(),
    memory: memoryStatus(),
    oi: oiStatus(),
    docs: ['/api/chat', '/api/quiz', '/api/notes', '/api/rag', '/api/health'],
  });
}