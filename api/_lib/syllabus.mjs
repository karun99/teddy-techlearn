import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

const require = createRequire(import.meta.url);

let _subjects = null;

export function loadAllSubjects() {
  if (_subjects) return _subjects;
  const subjects = [];
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.cjs'));
  for (const file of files) {
    try {
      const mod = require(join(DATA_DIR, file));
      const s = mod.default || mod;
      if (s && s.id) subjects.push(s);
    } catch (err) {
      console.error(`[syllabus] failed to load ${file}: ${err.message}`);
    }
  }
  subjects.sort((a, b) => {
    if (a.semester !== b.semester) return a.semester - b.semester;
    return String(a.id).localeCompare(String(b.id));
  });
  _subjects = subjects;
  return subjects;
}

export function getSubject(subjectId) {
  return loadAllSubjects().find((s) => s.id === subjectId) || null;
}

export function getSubjectByCode(code) {
  return loadAllSubjects().find((s) => s.code === code) || null;
}

export function getUnit(subjectId, unitNumber) {
  const s = getSubject(subjectId);
  if (!s) return null;
  const n = String(unitNumber);
  return s.units.find((u) => String(u.id) === n) || null;
}

export function getTopic(subjectId, unitNumber, topicNumber) {
  const u = getUnit(subjectId, unitNumber);
  if (!u) return null;
  const n = String(topicNumber);
  return (u.topics || []).find((t) => String(t.n || '').split('.')[0] === n ||
    String(t.n || '').endsWith(`.${n}`)) || null;
}

export function findTopicByFilename(filename) {
  const m = String(filename || '').match(/topic-([a-z0-9]+)-u(\d+)-t(\d+)\.html/);
  if (!m) return null;
  const [, subject, unit, topic] = m;
  const t = getTopic(subject, unit, topic);
  return t ? { subject: getSubject(subject), unit: getUnit(subject, unit), topic: t } : null;
}

export function getUnitQuestions(subjectId, unitNumber) {
  const u = getUnit(subjectId, unitNumber);
  if (!u) return { pyq: [], questions: [] };
  return {
    pyq: u.pyq || [],
    questions: (u.questions || []).map((q, i) => ({
      id: `${subjectId}-u${unitNumber}-q${i + 1}`,
      q: q.q,
      type: q.type || 'mcq',
      options: q.options || [],
      correct: typeof q.a === 'number' ? q.a : (parseInt(q.a, 10) || 0),
      explanation: q.explanation || '',
    })),
  };
}

export function syllabusStats() {
  const subjects = loadAllSubjects();
  const units = subjects.reduce((n, s) => n + (s.units?.length || 0), 0);
  const topics = subjects.reduce(
    (n, s) => n + (s.units?.reduce((t, u) => t + (u.topics?.length || 0), 0) || 0), 0
  );
  let pages = 0;
  try {
    pages = readdirSync(join(DATA_DIR, '..')).filter((f) => f.endsWith('.html')).length;
  } catch { /* fall back */ }
  if (!pages) pages = subjects.length * 4 + topics + 6;
  return { subjects: subjects.length, units, topics, pages };
}