/**
 * POST /api/chat
 * Body: { message, pageContext, learnerId?, provider?, history? }
 * Returns a grounded Teddy reply.
 */
import { readBody, cors, ok, error } from './_lib/http.mjs';
import { answerChat } from './_lib/chatcore.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'POST') return error(res, 'Method not allowed', 405);

  const body = await readBody(req);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return error(res, 'message is required');

  try {
    const result = await answerChat({
      message,
      pageContext: body.pageContext || null,
      learnerId: typeof body.learnerId === 'string' ? body.learnerId : null,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      history: Array.isArray(body.history) ? body.history : [],
    });
    return ok(res, result);
  } catch (err) {
    return error(res, err.message || 'chat failed', 500, { detail: 'internal' });
  }
}