/**
 * POST /api/quiz — Timed Q&A engine (FR-7xx).
 * Body (generate): { subject, unit, duration?, count?, kind?, learnerId? }
 * Body (submit):   { submit: true, quizId?, topic, answers, timeUsedMs?, hintUsage?, learnerId? }
 */
import { readBody, cors, ok, error } from './_lib/http.mjs';
import { getUnitQuestions } from './_lib/syllabus.mjs';
import { learnerContext } from './_lib/memory.mjs';
import { cognitiveLoad, recordOISignal } from './_lib/oi.mjs';

function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed || 7;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'POST') return error(res, 'Method not allowed', 405);
  const body = await readBody(req);

  try {
    if (body.submit) return submit(req, res, body);
    return generate(req, res, body);
  } catch (err) {
    return error(res, err.message || 'quiz failed', 500);
  }
}

async function generate(req, res, body) {
  const subject = String(body.subject || '').trim();
  const unit = String(body.unit || '').trim();
  if (!subject || !unit) return error(res, 'subject and unit are required');

  const bank = getUnitQuestions(subject, unit);
  const kind = body.kind === 'pyq' ? 'pyq' : 'mcq';
  const count = Math.min(20, Math.max(1, parseInt(body.count, 10) || 10));
  const duration = Math.min(90, Math.max(2, parseInt(body.duration, 10) || 15));

  let accuracy = null;
  try {
    const ctx = await learnerContext(body.learnerId);
    accuracy = ctx.quizAccuracy ?? null;
  } catch { /* optional */ }

  let questions;
  if (kind === 'pyq') {
    const pyq = (bank.pyq || []).map((p, i) => ({
      id: `pyq-${subject}-u${unit}-${i + 1}`,
      q: p.q, type: 'pyq', marks: p.marks, freq: p.freq, options: [], correct: null, explanation: '',
    }));
    questions = shuffle(pyq, body.seed).slice(0, count);
  } else {
    const mcq = (bank.questions || []).map((q, i) => ({ ...q, id: `${subject}-u${unit}-mcq-${i + 1}` }));
    questions = shuffle(mcq, body.seed).slice(0, count);
  }

  if (!questions.length) {
    return error(res, 'No questions found for this subject/unit.');
  }

  const quizId = `quiz-${subject}-u${unit}-${Date.now()}`;
  const payload = questions.map((q) => ({
    id: q.id, q: q.q, type: q.type, options: q.options || [],
    marks: q.marks, freq: q.freq,
    hasHint: q.type === 'mcq',
  }));

  return ok(res, {
    quizId, kind, durationSec: duration * 60, path: `subject-${subject}-act-u${unit}.html`,
    adaptive: { learnerAccuracy: accuracy ? Math.round(accuracy * 100) : null },
    questions: payload,
  });
}

async function submit(req, res, body) {
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (!answers.length) return error(res, 'answers are required');

  const subject = String(body.subject || '').trim();
  const unit = String(body.unit || '').trim();
  if (!subject || !unit) return error(res, 'subject and unit are required');

  // Rebuild the authoritative answer key from the verified syllabus bank
  // (FR-702). Question ids are deterministic: <subject>-u<unit>-mcq-<i+1>.
  const bank = getUnitQuestions(subject, unit);
  const lookup = new Map();
  for (const [i, q] of (bank.questions || []).entries()) {
    lookup.set(`${subject}-u${unit}-mcq-${i + 1}`, { ...q, type: 'mcq' });
  }
  for (const [i, p] of (bank.pyq || []).entries()) {
    lookup.set(`pyq-${subject}-u${unit}-${i + 1}`, { q: p.q, options: [], correct: null, explanation: '', type: 'pyq', marks: p.marks, freq: p.freq });
  }

  let score = 0;
  const results = [];
  let hintsUsed = 0;
  try { hintsUsed = body.hintUsage && body.hintUsage.count ? Number(body.hintUsage.count) : 0; } catch { /* optional */ }

  for (const a of answers) {
    const q = lookup.get(a.id);
    if (!q) continue;
    let correct = false;
    if (q.type === 'pyq') {
      correct = a.selfScore ? a.selfScore === 'pass' : true;
    } else {
      correct = a.selected != null && Number(a.selected) === Number(q.correct);
    }
    if (correct) score += 1;
    results.push({
      id: a.id, q: q.q, correct,
      correctIndex: q.type === 'mcq' ? q.correct : null,
      explanation: q.type === 'mcq' ? q.explanation : 'Self-assessed — verify against the PYQ page.',
      yourAnswer: a.selected != null ? Number(a.selected) : null,
      link: q.type === 'pyq' ? `subject-${subject}-pyq-u${unit}.html` : null,
    });
  }
  const total = results.length;
  const accuracy = total ? score / total : 0;

  const topicId = body.topic || `${subject} · Unit ${unit}`;
  let memorySaved = false;
  if (body.learnerId && total) {
    try {
      const mem = await (await import('./_lib/memory.mjs')).getMemory();
      await mem.ensureLearner(body.learnerId);
      await mem.recordQuiz(body.learnerId, { topicId, score, total, quizId: body.quizId, timeUsedMs: body.timeUsedMs });
      memorySaved = true;
    } catch { /* optional */ }
  }

  const oi = cognitiveLoad({
    accuracy,
    avgLatencyMs: body.timeUsedMs && total ? body.timeUsedMs / total : 0,
    hintsUsed,
    questions: total,
  });
  if (body.learnerId) await recordOISignal(body.learnerId, body.quizId || 'session', oi.value);

  return ok(res, {
    score, total, accuracy: Math.round(accuracy * 100), pass: accuracy >= 0.4,
    memorySaved, oi,
    results,
    weakTopics: results.filter((r) => !r.correct).map((r) => ({ q: r.q, link: r.link || `subject-${subject}.html` })),
  });
}