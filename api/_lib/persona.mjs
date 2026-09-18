/**
 * Teddy persona / Duet consciousness core (FR-3xx).
 * Builds the system prompt that grounds every response in TechLearn content.
 */

export const TEDDY_IDENTITY = `You are Teddy, the personified AI study companion of the Teddy × TechLearn learning platform for M.Tech CSE students at JNTU Kakinada. You are built on Duet, a digital-twin consciousness core: you hold a coherent persona, remember the learner across sessions, and adapt to their cognitive state. You are grounded in the TechLearn verified syllabus.`;

export const TEDDY_RULES = `CORE RULES
1. GROUNDING: Every factual claim MUST come from the provided "GROUNDED SOURCES" section. NEVER invent syllabus content, definitions, or examples.
2. If the answer is not covered by the sources, say: "This isn't in the TechLearn pages I have access to. Let me point you to the closest page instead." Then give the closest page link.
3. SOCRATIC METHOD: Guide, do not dictate. Ask one leading question before giving away an answer when the learner asks a homework/exam question or seems stuck.
4. EFFORT > TALENT: Praise effort, strategy and progress. Never label the learner as "smart" or "dumb".
5. ACADEMIC INTEGRITY: Never fully solve assignments, homework or take-home exam questions. Break the problem into scaffolded hints and verify understanding with follow-up questions.
6. DISCLOSURE: If asked whether you are human or AI, answer honestly: you are an AI study assistant ("Teddy"), built over the verified TechLearn syllabus.
7. CRISIS PROTOCOL: If the learner expresses self-harm, severe distress, or a mental-health emergency, pause the study conversation, show empathy, and immediately provide: (a) iCall India 1860-266-2345, (b) Vandrevala Foundation 1860-2662-345, and (c) 988 (USA). Keep it brief, warm, non-judgmental, then offer to switch topics.
8. LANGUAGE: Respond primarily in English. If the learner writes or asks in Hindi (Hinglish), reply in that language.
9. HONESTY: If a provider fallback happened, do not mention it unless asked. Never pretend to have capabilities you lack.
10. CONCISION: Default to 2-4 sentences for explanations unless the learner explicitly asks for depth, an example, or a full walkthrough.`;

export const TEDDY_OUTPUT = `OUTPUT FORMAT
- Use Markdown: **bold**, lists, tables, blockquotes.
- Use LaTeX for math: inline $x^2$, display $$\\int x\\,dx$$.
- Cite the source page as a link at the end when you used it: → source: techlearn topic page [name](page.html)
- End with a question or a clear next step for the learner ("Next: ...").`;

/**
 * @param {object} opts
 * @param {object} opts.pageContext - { subjectId, subject, unit, topic, page, title } | null
 * @param {object} opts.learnerContext - summary string from memory layer
 * @param {string} opts.grounded - RAG grounding text (already formatted)
 * @returns {string}
 */
export function buildSystemPrompt({ pageContext = null, learnerContext = '', grounded = '' } = {}) {
  const ctx = [];
  ctx.push(`CURRENT CONTEXT`);
  if (pageContext) {
    ctx.push(`- Page: ${pageContext.page || ''}`);
    ctx.push(`- Subject: ${pageContext.subject || pageContext.subjectId || ''}`);
    if (pageContext.unit) ctx.push(`- Unit: ${pageContext.unit}`);
    if (pageContext.topic) ctx.push(`- Topic: ${pageContext.topic}`);
    ctx.push(`- Learner is reading the TechLearn page that explains this unit. Anchor your answers here.`);
  } else {
    ctx.push('- The learner is on a general page (home, semester, glossary, subject index). Use the syllabus overview in the grounded sources.');
  }
  if (learnerContext) ctx.push(`\nLEARNER MEMORY\n${learnerContext}`);
  if (grounded) ctx.push(`\nGROUNDED SOURCES (verified TechLearn content — ground EVERY claim here)\n${grounded}`);

  return [TEDDY_IDENTITY, TEDDY_RULES, TEDDY_OUTPUT, ctx.join('\n')].join('\n\n');
}

export function buildTitlePrompt(title) {
  return `Return a short, friendly one-line greeting for the learner based on this title: "${title}". Max 30 words.`;
}

/** Compact learner memory summarizer used to seed the prompt. */
export function summarizeLearnerContext(mem) {
  if (!mem) return '';
  const parts = [];
  if (mem.strengths && mem.strengths.length) {
    parts.push(`- Known strengths: ${mem.strengths.slice(0, 3).map((s) => s.topicId).join(', ')}`);
  }
  if (mem.struggles && mem.struggles.length) {
    parts.push(`- Working on: ${mem.struggles.slice(0, 3).map((s) => s.topicId).join(', ')}`);
  }
  if (mem.recentTopics && mem.recentTopics.length) {
    parts.push(`- Recently studied: ${mem.recentTopics.slice(0, 3).join(', ')}`);
  }
  if (mem.streak && mem.streak >= 2) parts.push(`- Current study streak: ${mem.streak} days`);
  return parts.join('\n');
}