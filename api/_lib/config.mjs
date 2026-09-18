/**
 * Teddy per-user AI configuration (AI-CONFIG-1xx).
 *
 * A learner can pick their own provider, model and temperature, stored in the
 * learner graph (Neo4j or file fallback). API keys are NEVER stored server-side:
 * the widget keeps "bring your own key" (BYOK) in the browser's localStorage and
 * sends it per-request, so it survives only in transit.
 */
import { getMemory } from './memory.mjs';
import { PROVIDERS } from './router.mjs';

export const CONFIG_KEYS = ['provider', 'model', 'temperature', 'maxTokens'];
const DEFAULT_CONFIG = { provider: '', model: '', temperature: 0.4, maxTokens: 900 };

export function providerKeys() {
  return PROVIDERS.map((p) => p.key);
}

/** Whitelist + range validation; strips any key that isn't a config field. */
export function sanitizeConfig(raw = {}) {
  const out = { ...DEFAULT_CONFIG };
  if (typeof raw === 'object' && raw) {
    if (providerKeys().includes(raw.provider)) out.provider = raw.provider;
    if (typeof raw.model === 'string') {
      const m = raw.model.trim().replace(/[^A-Za-z0-9._:/\-\s]/g, '');
      if (m && m.length <= 80) out.model = m;
    }
    if (typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 1) {
      out.temperature = Math.round(raw.temperature * 100) / 100;
    }
    if (typeof raw.maxTokens === 'number') {
      const mt = Math.round(raw.maxTokens);
      if (mt >= 64 && mt <= 4096) out.maxTokens = mt;
    }
  }
  return out;
}

export async function getAiConfig(learnerId) {
  if (!learnerId) return { ...DEFAULT_CONFIG, configured: false };
  try {
    const mem = await getMemory();
    await mem.ensureLearner(learnerId);
    const stored = await mem.getAiConfig(learnerId);
    const cfg = sanitizeConfig(stored || {});
    return { ...cfg, configured: Boolean(stored) };
  } catch {
    return { ...DEFAULT_CONFIG, configured: false };
  }
}

export async function saveAiConfig(learnerId, raw) {
  const mem = await getMemory();
  await mem.ensureLearner(learnerId);
  const cfg = sanitizeConfig(raw);
  // never persist an API key even if it sneaks into the body
  delete cfg.configured;
  return mem.setAiConfig(learnerId, cfg);
}

export async function clearAiConfig(learnerId) {
  const mem = await getMemory();
  await mem.ensureLearner(learnerId);
  return mem.clearAiConfig(learnerId);
}