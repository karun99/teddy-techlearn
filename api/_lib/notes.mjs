/**
 * Teddy Notes Writing Helper (FR-8xx).
 * Deterministic, grounded note generation from syllabus data with optional LLM polish.
 */
import { getSubject, getUnit, getTopic } from './syllabus.mjs';
import { retrieve } from './rag.mjs';

export const NOTE_TEMPLATES = ['cornell', 'outline', 'flashcards'];

function glossaryForTopic(topic) {
  const q = (topic.title || '').split(' ').join(' ');
  const { hits } = retrieve(`${q} `, { limit: 3, minScore: 0 });
  return (hits || []).filter((h) => h.type === 'glossary').slice(0, 3);
}

export function buildLocalNote({ subjectId, unitNumber, topicNumber, template = 'cornell', learnerText = '' }) {
  const subject = getSubject(subjectId);
  const unit = getUnit(subjectId, unitNumber);
  const topic = getTopic(subjectId, unitNumber, topicNumber) ||
    (unit?.topics?.[0]);
  if (!subject || !unit || !topic) {
    throw new Error(`cannot build note: unknown topic ${subjectId}/u${unitNumber}/t${topicNumber}`);
  }

  const title = `${subject.short || subject.title} · Unit ${unit.id} · ${topic.n || ''} ${topic.title}`;
  const keyConcepts = collectList(topic.content, 'ul');
  const keyPoints = collectList(topic.content, 'points') || [];
  const pyqFocus = (unit.pyq || []).slice(0, 3).map((p) => p.q).join('\n');
  const page = `topic-${subject.id}-u${unit.id}-t${topic.n}.html`;
  const actPage = `subject-${subject.id}-act-u${unit.id}.html`;
  const pyqPage = `subject-${subject.id}-pyq-u${unit.id}.html`;

  switch (template) {
    case 'flashcards':
      return { title, page, content: flashcardsNote(title, keyConcepts, keyPoints) };
    case 'outline':
      return { title, page, content: outlineNote(subject, unit, topic, keyConcepts, keyPoints, pyqFocus, page) };
    case 'cornell':
    default:
      return { title, page, content: cornellNote(subject, unit, topic, keyConcepts, keyPoints, pyqFocus, page, actPage, learnerText) };
  }
}

function collectList(content, type) {
  const hit = (content || []).find((c) => c.type === type && Array.isArray(c.items));
  return hit ? hit.items : [];
}

function cornellNote(subject, unit, topic, keyConcepts, keyPoints, pyqFocus, page, actPage, learnerText) {
  const cues = keyPoints.length ? keyPoints.slice(0, 5) : keyConcepts.slice(0, 5);
  return `# ${topic.n} ${topic.title}

**Course:** ${subject.title} · Unit ${unit.id} — ${unit.title}
**Method:** Cornell Notes

## 📌 Cue Column (questions to ask yourself)
${cues.map((c) => `- **${c}** — can you explain this in your own words?`).join('\n')}

## ✍️ Notes Column (key points, grounded in TechLearn)
${keyConcepts.map((c) => `- ${c}`).join('\n') || '- (no key concepts listed — revisit the topic page)'}
${keyPoints.map((p) => `- ${p}`).join('\n')}

## 💡 Summary (write in 2–3 sentences after reviewing)
${learnerText ? learnerText + '\n' : '- …'}

## 🔗 Links
- [Read the full topic](${page})
- [Take the unit activity](${actPage})

## 🎯 Exam Focus (prior year questions)
${pyqFocus || '- none listed'}`.trim();
}

function outlineNote(subject, unit, topic, keyConcepts, keyPoints, pyqFocus, page) {
  return `# ${topic.n} ${topic.title}

**Course:** ${subject.title} · Unit ${unit.id} — ${unit.title}
**Method:** Outline

I. Introduction
   A. ${topic.title}
II. Core Concepts
${renderOutline(keyConcepts)}
III. Key Points
${renderOutline(keyPoints)}
IV. PYQ Focus
${pyqFocus ? pyqFocus.split('\n').map((q) => '   - ' + q).join('\n') : '   - none listed'}
V. Source
   - [${page}](${page})

---
Grounding: TechLearn verified syllabus (data/*.cjs).`.trim();
}

function renderOutline(items) {
  return (items || []).map((it, i) => `   ${String.fromCharCode(65 + i)}. ${it}`).join('\n');
}

function flashcardsNote(title, keyConcepts, keyPoints) {
  const cards = [];
  const kc = keyConcepts.length ? keyConcepts : keyPoints;
  for (let i = 0; i < kc.length; i += 1) {
    cards.push([
      `What is '${kc[i]}' (${title})?`,
      `Explain ${kc[i]} using the TechLearn topic page. Key points: ${keyPoints[i] || 'review the topic page.'}`,
    ]);
  }
  return kc.length
    ? cards.map(([f, b]) => `Q: ${f}\nA: ${b}`).join('\n\n')
    : `Q: Review ${title}\nA: No flashcards generated — revisit the topic page.`;
}

/** Export formats (FR-806). */
export function exportNote(note, format = 'markdown') {
  if (format === 'json') return JSON.stringify(note, null, 2);
  if (format === 'anki-csv') return ankiCsv(note.content);
  return note.content;
}

function ankiCsv(content) {
  return content
    .split(/\n\n+/)
    .filter((b) => /^Q:/m.test(b))
    .map((b) => {
      const [q, ...a] = b.split('\n');
      const answer = (a.join(' ').replace(/^A:\s*/, '')) || '';
      return `${csvEscape(q.replace(/^Q:\s*/, ''))},${csvEscape(answer)}`;
    })
    .join('\n');
}

function csvEscape(s) {
  const v = String(s).replace(/"/g, '""');
  return `"${v}"`;
}