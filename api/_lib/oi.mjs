/**
 * Organoid Intelligence adapter — SIMULATED (FR-11xx, optional).
 * No hardware required. Produces a plausible cognitive-load signal per session
 * from behavioral proxies (accuracy, latency, hint usage) and can emit a
 * learning-strategy recommendation. All decisions are logged (FR-1106).
 */
import { getMemory } from './memory.mjs';

const ENABLED = process.env.OI_ENABLED !== 'false';

export function oiStatus() {
  return { enabled: ENABLED, mode: ENABLED ? 'simulated' : 'disabled' };
}

/**
 * @param {object} sessionStats { accuracy: 0..1, avgLatencyMs, hintsUsed, questions, totalTimeMs }
 * @returns {{ value: number, level: string, recommendation: string, source: string }}
 */
export function cognitiveLoad(sessionStats = {}) {
  const { accuracy = 0.5, avgLatencyMs = 0, hintsUsed = 0, questions = 1, totalTimeMs = 0 } = sessionStats;
  const acc = Math.max(0, Math.min(1, accuracy));
  const hints = Math.min(1, (hintsUsed || 0) / Math.max(1, questions));

  // Higher load when accuracy is low, hints high, or pacing too slow/fast.
  let value = 0.55;
  value += (1 - acc) * 0.3;
  value += hints * 0.2;
  if (avgLatencyMs > 0) {
    const slowRatio = Math.min(1, avgLatencyMs / 60000);
    value += (slowRatio - 0.3) * 0.15;
  }
  value = Math.max(0, Math.min(1, value));

  return {
    value: Math.round(value * 100) / 100,
    level: value < 0.45 ? 'low' : value < 0.7 ? 'moderate' : 'high',
    recommendation:
      value >= 0.75
        ? 'Cognitive load is high — suggest a 5-minute break, then a lighter recap.'
        : value >= 0.6
          ? 'Load is climbing — suggest reviewing one topic at a time with a quick quiz.'
          : 'Load looks comfortable — suggest maintaining current pace.',
    source: 'simulated',
  };
}

/** Persist an OI signal to the graph memory (FR-1103). */
export async function recordOISignal(learnerId, sessionId, value) {
  if (!ENABLED) return null;
  try {
    const mem = await getMemory();
    await mem.ensureLearner(learnerId);
    await mem.setCognitiveLoad(learnerId, { sessionId, value, source: 'simulated' });
    return { logged: true };
  } catch (err) {
    return { logged: false, error: err.message };
  }
}