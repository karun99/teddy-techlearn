/**
 * Teddy AI Provider Router (FR-10xx)
 * Unified interface over ≥6 LLM providers with automatic fallback.
 */
import process from 'node:process';

export const PROVIDERS = [
  { key: 'gemini', env: 'GEMINI_API_KEY', defaultModel: 'gemini-1.5-flash', label: 'Gemini' },
  { key: 'openrouter', env: 'OPENROUTER_API_KEY', defaultModel: 'meta-llama/llama-3.3-70b-instruct', label: 'OpenRouter' },
  { key: 'openai', env: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini', label: 'OpenAI' },
  { key: 'anthropic', env: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-haiku-latest', label: 'Anthropic' },
  { key: 'groq', env: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', label: 'Groq' },
  { key: 'ollama', env: 'OLLAMA_MODEL', defaultModel: 'llama3.2', label: 'Ollama (local)', local: true },
];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));

export function listAvailableProviders() {
  return PROVIDERS.map((p) => ({
    key: p.key,
    label: p.label,
    model: envModel(p),
    available: isAvailable(p),
    local: !!p.local,
  }));
}

function envModel(p) {
  return process.env[`${p.key.toUpperCase()}_MODEL`] || p.defaultModel;
}

export function isAvailable(p) {
  if (typeof p === 'string') p = PROVIDER_MAP[p];
  if (!p) return false;
  if (p.local) return process.env.OLLAMA_HOST || process.env.OLLAMA_ENABLED === 'true';
  return Boolean(process.env[p.env]);
}

/**
 * Availability for one request. A provider is usable when the server has its
 * env key OR the user supplied a BYOK key for exactly that provider
 * (apiKeyFor === provider.key). Not persisted anywhere.
 */
export function isUsable(p, { apiKey, apiKeyFor } = {}) {
  if (typeof p === 'string') p = PROVIDER_MAP[p];
  if (!p) return false;
  if (isAvailable(p)) return true;
  return Boolean(apiKey && apiKeyFor === p.key && !p.local);
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Cast an OpenAI-style error payload into a readable message. */
function httpError(res, body) {
  const msg =
    (body && (body.error?.message || body.message)) ||
    `HTTP ${res.status} ${res.statusText}`;
  return new Error(msg);
}

async function postJSON(url, body, headers = {}, timeoutMs = 45000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw httpError(res, parseJsonResponse(text));
    return parseJsonResponse(text) || text;
  } finally {
    clearTimeout(timer);
  }
}

/** Call one provider; returns { text, provider, model }. apiKey overrides the env key for this provider. */
export async function callProvider(providerKey, messages, { model, temperature = 0.4, maxTokens = 900, apiKey } = {}) {
  const p = PROVIDER_MAP[providerKey];
  if (!p) throw new Error(`unknown provider: ${providerKey}`);
  if (!isUsable(p.key, { apiKey })) {
    throw new Error(`provider unavailable: ${providerKey} (missing ${p.env} or a user key)`);
  }
  model = model || envModel(p);

  let text;
  switch (p.key) {
    case 'gemini': {
      const key = apiKey || process.env.GEMINI_API_KEY;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const parts = messages.map((m) => ({ role: m.role === 'system' ? 'user' : m.role, parts: [{ text: m.content }] }));
      const data = await postJSON(url, {
        systemInstruction: { parts: [{ text: messages.find((m) => m.role === 'system')?.content || '' }] },
        contents: parts.filter((p) => p.role !== 'system'),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      });
      text = data?.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') || '';
      if (!text) throw new Error('gemini returned empty response');
      break;
    }
    case 'anthropic': {
      const data = await postJSON(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: maxTokens,
          temperature,
          system: messages.find((m) => m.role === 'system')?.content || '',
          messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
        },
        { 'x-api-key': apiKey || process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
      );
      text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (!text) throw new Error('anthropic returned empty response');
      break;
    }
    case 'ollama': {
      const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
      const data = await postJSON(`${host}/api/chat`, {
        model,
        messages,
        stream: false,
        options: { temperature },
      });
      text = data?.message?.content || '';
      if (!text) throw new Error('ollama returned empty response');
      break;
    }
    // OpenAI-compatible: openai, openrouter, groq
    default: {
      const cfg = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY, h: {} },
        openrouter: {
          url: 'https://openrouter.ai/api/v1/chat/completions',
          key: process.env.OPENROUTER_API_KEY,
          h: { 'HTTP-Referer': process.env.VERCEL_PROJECT_PRODUCTION_URL || 'https://teddy-techlearn.vercel.app',
               'X-Title': 'Teddy × TechLearn' },
        },
        groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, h: {} },
      }[p.key];
      const data = await postJSON(cfg.url, { model, messages, temperature, max_tokens: maxTokens }, { Authorization: `Bearer ${apiKey || cfg.key}`, ...cfg.h });
      text = data?.choices?.[0]?.message?.content || '';
      if (!text) throw new Error(`${p.key} returned empty response`);
    }
  }

  return { text: text.trim(), provider: p.key, model, label: p.label };
}

/** Ordered fallback chain. Preferred at front. Respects a per-request BYOK key. */
export function ordering(prefer, { apiKey, apiKeyFor } = {}) {
  const prefs = Array.isArray(prefer) ? prefer : [prefer];
  const base = PROVIDERS.filter((p) => isUsable(p, { apiKey, apiKeyFor }));
  const ranked = [];
  for (const k of prefs) {
    const hit = base.find((p) => p.key === k);
    if (hit && !ranked.includes(hit)) ranked.push(hit);
  }
  for (const p of base) if (!ranked.includes(p)) ranked.push(p);
  if (ranked.length === 0 && (process.env.ENABLE_LOCAL_ONLY !== 'false')) {
    const ollama = PROVIDER_MAP.ollama;
    if (process.env.ALLOW_OLLAMA_FALLBACK === 'true') ranked.push(ollama);
  }
  return ranked;
}

/** Try providers in order until one succeeds. A BYOK key is only sent to its own provider. */
export async function callWithFallback(messages, { prefer, model, temperature, maxTokens, apiKey, apiKeyFor } = {}) {
  const chain = ordering(prefer, { apiKey, apiKeyFor });
  const errors = [];
  if (chain.length === 0) {
    throw new Error('no-llm-configured');
  }
  for (const p of chain) {
    const keyForThis = apiKeyFor === p.key ? apiKey : undefined;
    try {
      const out = await callProvider(p.key, messages, { model, temperature, maxTokens, apiKey: keyForThis });
      return { ...out, fallbacks: errors.length };
    } catch (err) {
      errors.push(`${p.key}: ${err.message}`);
    }
  }
  const e = new Error(`all providers failed [${errors.join(' | ')}]`);
  e.providerErrors = errors;
  throw e;
}