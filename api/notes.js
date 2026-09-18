/**
 * POST /api/notes — Notes generation & persistence (FR-8xx).
 * Body (generate): { subject, unit, topic, template?, learnerText?, learnerId? }
 * Body (save):     { save: true, learnerId, note: { title, content, format, topicId } }
 * Body (export):   { export: true, note, format }
 */
import { readBody, cors, ok, error } from './_lib/http.mjs';
import { buildLocalNote, exportNote, NOTE_TEMPLATES } from './_lib/notes.mjs';
import { getMemory } from './_lib/memory.mjs';
import { getSubject, getUnit } from './_lib/syllabus.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return cors(res);
  if (req.method !== 'POST') return error(res, 'Method not allowed', 405);
  const body = await readBody(req);

  try {
    if (body.save) return save(req, res, body);
    if (body.export) return doExport(req, res, body);
    return generate(req, res, body);
  } catch (err) {
    return error(res, err.message || 'notes failed', 500);
  }
}

function generate(req, res, body) {
  const subjectId = String(body.subject || body.subjectId || '').trim();
  const unitNumber = String(body.unit || body.unitNumber || '').trim();
  const topicNumber = String(body.topic || body.topicNumber || '').trim();
  const template = NOTE_TEMPLATES.includes(body.template) ? body.template : 'cornell';

  if (!subjectId || !unitNumber) return error(res, 'subject and unit are required');
  const subject = getSubject(subjectId);
  if (!subject) return error(res, `unknown subject: ${subjectId}`);
  if (!getUnit(subjectId, unitNumber)) return error(res, `unknown unit: ${unitNumber}`);

  const note = buildLocalNote({
    subjectId, unitNumber, topicNumber, template,
    learnerText: typeof body.learnerText === 'string' ? body.learnerText : '',
  });
  return ok(res, { note, template, formats: ['markdown', 'json', 'anki-csv', 'pdf'], links: { topic: note.page } });
}

async function save(req, res, body) {
  const note = body.note || {};
  const learnerId = String(body.learnerId || '').trim();
  if (!learnerId || !note.content) return error(res, 'learnerId and note.content are required');

  const mem = await getMemory();
  await mem.ensureLearner(learnerId);
  const saved = {
    id: note.id || `note-${Date.now()}`,
    title: note.title || 'Untitled note',
    content: note.content,
    format: note.format || 'cornell',
    topicId: note.topicId || null,
  };
  await mem.recordNote(learnerId, saved);
  return ok(res, { saved: true, note: saved });
}

function doExport(req, res, body) {
  const note = body.note || {};
  const format = body.format || 'markdown';
  if (!note.content) return error(res, 'note.content required');
  let out;
  try { out = exportNote(note, format); }
  catch (e) { return error(res, e.message); }
  return ok(res, { format, content: out, filename: slug(note.title || 'teddy-notes') + ext(format) });
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'teddy-notes'; }
function ext(f) { return f === 'json' ? '.json' : f === 'anki-csv' || f === 'csv' ? '.csv' : '.md'; }