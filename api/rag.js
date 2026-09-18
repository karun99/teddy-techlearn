/**
 * POST /api/rag — techlearn corpus query (FR-5xx).
 * Body: { query, subjectId?, limit? }
 */
import { readBody, cors, ok, error } from './_lib/http.mjs';
import { retrieve, getCorpus } from './_lib/rag.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'POST') return error(res, 'Method not allowed', 405);
  const body = await readBody(req);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return error(res, 'query is required');
  if (body.stats) {
    const c = getCorpus();
    return ok(res, {
      documents: { total: c.docs.length, topics: c.docs.filter((d) => d.doc.type === 'topic').length },
      hits: [],
      query,
    });
  }
  const limit = Math.min(10, Math.max(1, parseInt(body.limit, 10) || 5));
  const { hits, queryTokens } = retrieve(query, {
    limit,
    subjectId: typeof body.subjectId === 'string' ? body.subjectId : undefined,
    minScore: 0,
  });
  return ok(res, { query, queryTokens, hits });
}