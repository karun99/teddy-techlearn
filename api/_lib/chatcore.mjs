/**
 * Chat orchestration: page context → RAG grounding → persona → provider router.
 * Includes a retrieval-only fallback so the platform works even with no LLM key
 * configured (FR-1005 / NFR-2xx graceful degradation).
 */
import { retrieve, groundingContext, isGrounded } from './rag.mjs';
import { buildSystemPrompt, summarizeLearnerContext } from './persona.mjs';
import { callWithFallback } from './router.mjs';
import { learnerContext, getMemory } from './memory.mjs';
import { getAiConfig } from './config.mjs';

const CRISIS = /(i.*(want|feel|think).*(die|kill|end my|suicid)|suicid|self.?harm|end my life|no point living)/i;

export function detectPageContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const page = raw.page || raw.pathname || '';
  const subjectId = raw.subjectId || raw.subject || '';
  const m = String(page).match(/topic-([a-z0-9]+)-u(\d+)-t(\d+)\.html/);
  return {
    page: String(page),
    subjectId,
    unit: raw.unit || (m ? `Unit ${m[2]}` : null),
    topic: raw.topic || (m ? `Topic ${m[3]}` : null),
    subject: raw.subjectTitle || raw.subjectName || '',
  };
}

export function crisisResponse() {
  return {
    reply:
      `I'm really glad you reached out. You matter, and this feeling can get better with support. 💙\n\n` +
      `Here are people who can help right now:\n` +
      `- **iCall India**: 1860-266-2345 (Mon–Sat, 10am–8pm)\n` +
      `- **Vandrevala Foundation**: 1860-2662-345 (24×7)\n` +
      `- **988 Suicide & Crisis Lifeline** (US): call or text 988\n\n` +
      `Please reach out, or if you're with someone you trust, tell them what you're feeling. We can pause learning — there's no pressure here. 🧸`,
    mode: 'crisis',
    sources: [],
    verified: true,
  };
}

function refusalReply(hits) {
  const closest = hits.slice(0, 2).map((h) => `- [${h.title}](${h.page})`).join('\n');
  return {
    reply:
      `This isn't in the TechLearn pages I have access to, so I won't guess (FR-505).\n\n` +
      `Closest verified pages:\n${closest || '- none found — try a different question.'}\n\n` +
      `Tip: ask about anything in the JNTU Kakinada syllabus — topics, PYQs, or glossary terms. 🧸`,
    mode: 'refused',
    sources: closest,
    verified: true,
  };
}

/** Grounded, retrieval-only answer used when no LLM provider is configured. */
function compiledAnswer(query, hits) {
  const top = hits[0];
  const bullets = (hits.slice(0, 3) || []).map((h) => `- **${h.title}** — ${h.snippets.slice(0, 160).trim()}…`).join('\n');
  const hasTopic = top && top.type === 'topic';
  return {
    reply:
      `Here's what TechLearn covers for *"${query}"*:\n\n${bullets}\n\n` +
      (hasTopic
        ? `\n> 📖 **Recommended read:** [${top.title}](${top.page}) — then try the [unit activity](${top.page.replace(/topic-([a-z0-9]+)-u(\d+)-t(\d+)/, 'subject-$1-act-u$2')}) to check yourself.`
        : '') +
      `\n\n_I'm running in offline-answer mode. Add an LLM API key to get full conversational help._ 🧸`,
    mode: 'offline',
    sources: hits.map((h) => ({ page: h.page, title: h.title })),
    verified: true,
    topHit: top ? { page: top.page, title: top.title } : null,
  };
}

function keywordCheck(answer, hits) {
  if (!hits.length) return true;
  const text = answer.toLowerCase();
  const tokens = (hits[0].title + ' ' + (hits[0].snippets || ''))
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4);
  const unique = [...new Set(tokens)].slice(0, 8);
  const matched = unique.filter((w) => text.includes(w)).length;
  return unique.length ? matched / unique.length >= 0.15 : true;
}

export async function answerChat({ message, pageContext, learnerId, provider, history = [], aiConfig } = {}) {
  const q = String(message || '').trim();
  if (!q) return { reply: 'Ask me anything about your M.Tech CSE syllabus! 🧸', mode: 'idle', sources: [], verified: true };

  if (CRISIS.test(q)) return crisisResponse();

  const ctx = detectPageContext(pageContext);
  const { hits } = retrieve(q, { limit: 4, subjectId: ctx?.subjectId || undefined });

  if (!isGrounded(hits, 10)) return refusalReply(hits);

  const grounded = hits.length ? groundingContext(hits) : '';
  let mem = {};
  try { mem = await learnerContext(learnerId); } catch { /* memory optional */ }
  const learnerSummary = summarizeLearnerContext(mem);

  // Per-user AI config: stored in the learner graph, overridable per request
  // (aiConfig may carry a BYOK apiKey that is not persisted anywhere).
  let stored = {};
  try { stored = await getAiConfig(learnerId); } catch { /* config optional */ }
  const cfg = { ...stored, ...(aiConfig || {}) };
  const prefer = cfg.provider || provider || undefined;
  const apiKey = typeof cfg.apiKey === 'string' && cfg.apiKey.trim() ? cfg.apiKey.trim() : undefined;
  const apiKeyFor = prefer || undefined;
  const temperature = clampNum(cfg.temperature, 0, 1, 0.4);
  const maxTokens = clampNum(cfg.maxTokens, 64, 4096, 900);

  const systemPrompt = buildSystemPrompt({
    pageContext: { ...(ctx || {}), subjectId: ctx?.subjectId || '' },
    learnerContext: learnerSummary,
    grounded,
  });

  const messagesArr = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-12),
    { role: 'user', content: q },
  ];

  let mode = 'llm';
  let providerUsed = null;
  let text;
  try {
    const out = await callWithFallback(messagesArr, {
      prefer, model: stringVal(cfg.model) || undefined, temperature, maxTokens, apiKey, apiKeyFor,
    });
    text = out.text;
    mode = 'llm';
    providerUsed = out.provider;
  } catch (err) {
    if (err.message === 'no-llm-configured') {
      const fallback = compiledAnswer(q, hits);
      persistInteraction(learnerId, q, fallback.reply, ctx, 'offline').catch(() => {});
      return fallback;
    }
    // Provider outage → degrade to retrieval-only but stay honest.
    const fallback = compiledAnswer(q, hits);
    fallback.mode = 'degraded';
    persistInteraction(learnerId, q, fallback.reply, ctx, 'degraded').catch(() => {});
    return fallback;
  }

  const verified = keywordCheck(text, hits);
  let reply = text;
  if (verified && !/\[.*\]\(.*\).*/.test(text) && hits.length) {
    const src = hits[0];
    reply += `\n\n> 📖 [${src.title}](${src.page})`;
  }
  if (!verified) {
    reply += `\n\n> ⚠️ I pulled this from provider ${providerUsed}, but I could not fully verify it against the TechLearn source. Please re-read [the topic page](${hits[0].page}).`;
  }

  persistInteraction(learnerId, q, reply, ctx, mode, providerUsed).catch(() => {});
  return {
    reply,
    mode,
    provider: providerUsed,
    verified,
    sources: hits.map((h) => ({ page: h.page, title: h.title })),
    topHit: hits[0] ? { page: hits[0].page, title: hits[0].title, type: hits[0].type } : null,
  };
}

function stringVal(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

async function persistInteraction(learnerId, question, answer, ctx, mode, provider) {
  if (!learnerId) return;
  try {
    const mem = await getMemory();
    await mem.ensureLearner(learnerId);
    if (ctx?.subjectId) await mem.recordStudy(learnerId, `${ctx.subjectId}`).catch(() => {});
    if (ctx && ctx.topic && ctx.unit) {
      // best-effort topic-level study edge
      await mem.recordStudy(learnerId, `${ctx.subjectId} · ${ctx.unit}`).catch(() => {});
    }
  } catch {
    /* persist is best effort */
  }
}