/**
 * /api/config — per-user AI configuration control (AI-CONFIG-1xx).
 *
 *   GET    /api/config?learnerId=me   → stored config + effective availability
 *   PUT    /api/config                → { learnerId, config:{provider,model,temperature,maxTokens} }
 *   DELETE /api/config                → { learnerId }  (back to server defaults)
 *   POST   /api/config                → { learnerId, action:'test', provider, apiKey?, model? }
 *
 * Secret policy: API keys are never read back or persisted. A BYOK key passed in
 * `apiKey` on a request is used only for that call (and for a manual test), then
 * discarded.
 */
import { readBody, cors, ok, error, requireStr } from './_lib/http.mjs';
import { getAiConfig, saveAiConfig, clearAiConfig, providerKeys } from './_lib/config.mjs';
import { listAvailableProviders, callProvider } from './_lib/router.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);

  if (req.method === 'GET') {
    const learnerId = (req.url || '').split('?')[1] ? new URL(req.url, 'http://x').searchParams.get('learnerId') : null;
    const cfg = await getAiConfig(learnerId);
    return ok(res, {
      configured: cfg.configured,
      config: { provider: cfg.provider, model: cfg.model, temperature: cfg.temperature, maxTokens: cfg.maxTokens },
      providers: listAvailableProviders(),
      byokProviders: providerKeys().filter((k) => k !== 'ollama'),
      note: 'API keys stay in your browser only (send via apiKey on chat requests).',
    });
  }

  const body = await readBody(req);
  const learnerId = requireStr(body.learnerId);

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!learnerId) return error(res, 'learnerId is required');
    const saved = await saveAiConfig(learnerId, body.config || {});
    return ok(res, { saved: true, config: saved });
  }

  if (req.method === 'DELETE') {
    if (!learnerId) return error(res, 'learnerId is required');
    await clearAiConfig(learnerId);
    return ok(res, { cleared: true, config: { provider: '', model: '', temperature: 0.4, maxTokens: 900 } });
  }

  if (req.method === 'POST') {
    if (body.action === 'test') {
      const provider = requireStr(body.provider);
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : '';
      if (!provider || !providerKeys().includes(provider) || provider === 'ollama') {
        return error(res, 'a valid byok provider is required (gemini/openrouter/openai/anthropic/groq)');
      }
      if (!apiKey) return error(res, 'apiKey is required to test a provider');
      const model = requireStr(body.model) || undefined;
      const t0 = Date.now();
      try {
        const out = await callProvider(provider, [{ role: 'user', content: 'Reply with the single word OK.' }], {
          model, temperature: 0, maxTokens: 16, apiKey,
        });
        return ok(res, {
          tested: true, provider, model: out.model,
          reply: out.text.slice(0, 80), latencyMs: Date.now() - t0,
        });
      } catch (err) {
        return ok(res, { tested: false, provider, error: err.message, latencyMs: Date.now() - t0 }, 502);
      }
    }
    return error(res, 'unsupported action (use GET/PUT/DELETE, or action:"test")');
  }

  return error(res, 'Method not allowed', 405);
}