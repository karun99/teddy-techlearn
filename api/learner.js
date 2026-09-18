/**
 * DELETE /api/learner — right to erasure (FR-904, GDPR/DPDP Act).
 * Body: { learnerId }
 */
import { readBody, cors, ok, error } from './_lib/http.mjs';
import { getMemory } from './_lib/memory.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'DELETE') return error(res, 'Method not allowed', 405);
  const body = await readBody(req);
  const learnerId = String(body.learnerId || '').trim();
  if (!learnerId) return error(res, 'learnerId is required');

  try {
    const mem = await getMemory();
    await mem.ensureLearner(learnerId).catch(() => {});
    const removed = await mem.deleteLearner(learnerId);
    return ok(res, { erased: removed, learnerId });
  } catch (err) {
    return error(res, err.message || 'erase failed', 500);
  }
}