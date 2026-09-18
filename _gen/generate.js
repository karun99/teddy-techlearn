/* ============================================================
   M.Tech CSE Learning App — Static Page Generator
   Reads data/subjects.js and emits:
     - subject hub pages (subject.html)
     - separate topic pages (topic-<subject>-u<unit>-t<topic>.html)
     - unit pages (subject-u1.html ... via hub sections? -> separate unit pages)
     - activity pages (subject-act-u<unit>.html)
     - PYQ pages (subject-pyq-<unit>.html and subject-pyq-overall.html)
   Output: pure static HTML (runtime has NO build step).
   Run: node _gen/generate.js
   ============================================================ */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DATA_DIR = join(ROOT, 'data');
if (!existsSync(DATA_DIR)) {
  console.error('Missing data directory:', DATA_DIR);
  process.exit(1);
}

// Load all .js files from data dir, preserving order by numbered filename prefix.
const { readdirSync } = await import('fs');
const { createRequire } = await import('module');
const req = createRequire(import.meta.url);
let dataFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.cjs')).sort();
let SUBJECTS = [];
for (const f of dataFiles) {
  let s;
  try {
    s = req(join(DATA_DIR, f));
  } catch (e) {
    console.error('Skipping', f, e.message);
    continue;
  }
  s = s.default || s;
  if (Array.isArray(s)) SUBJECTS = SUBJECTS.concat(s);
  else if (s && s.id) SUBJECTS.push(s);
}

SUBJECTS = SUBJECTS.filter((s) => s && s.id);
if (!SUBJECTS.length) {
  console.error('No subjects loaded from data dir.');
  process.exit(1);
}

/* ---------------- shared templates ---------------- */

const NAV = `
<nav class="main-nav">
  <div class="nav-brand">
    <a href="index.html"><span class="brand-icon"><i class="fas fa-graduation-cap"></i></span>
      <span>M.Tech CSE<small>JNTUK</small></span></a>
  </div>
  <button class="nav-toggle" id="navToggle" aria-label="Menu"><i class="fas fa-bars"></i></button>
  <div class="nav-links" id="navLinks">
    <a href="index.html" class="nav-link"><i class="fas fa-home"></i> Home</a>
    <a href="semester1.html" class="nav-link"><i class="fas fa-1"></i> Sem 1</a>
    <a href="semester2.html" class="nav-link"><i class="fas fa-2"></i> Sem 2</a>
    <a href="semester3.html" class="nav-link"><i class="fas fa-3"></i> Sem 3</a>
    <a href="semester4.html" class="nav-link"><i class="fas fa-4"></i> Sem 4</a>
    <a href="glossary.html" class="nav-link"><i class="fas fa-book"></i> Glossary</a>
  </div>
  <div class="nav-progress"><i class="fas fa-chart-line"></i><span id="overallProgress">0%</span></div>
</nav>`;

const FOOTER = `
<footer class="site-footer">
  <p><i class="fas fa-graduation-cap"></i> &copy; 2026 M.Tech CSE Learning Hub — JNTU Kakinada. <a href="task.md">About this app</a></p>
</footer>`;

function head(title, desc, extra = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | M.Tech CSE</title>
<meta name="description" content="${esc(desc)}">
<link rel="shortcut icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎓</text></svg>">
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
${extra}
</head>`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

function breadcrumb(items) {
  let html = '<div class="breadcrumb">';
  items.forEach((it, i) => {
    if (i > 0) html += '<span class="sep">/</span>';
    if (it.href) html += `<a href="${it.href}">${it.label}</a>`;
    else html += `<span>${it.label}</span>`;
  });
  html += '</div>';
  return html;
}

function mermaidInit() {
  return `
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad:true, theme:'base', themeVariables:{ primaryColor:'#2563eb', primaryTextColor:'#ffffff', primaryBorderColor:'#1d4ed8', lineColor:'#64748b', fontSize:'14px' } });</script>`;
}

function diagramBlock(diagram) {
  return `
<div class="diagram-wrapper">
  <div class="diagram-controls">
    <button onclick="zoomIn(this)" title="Zoom In"><i class="fas fa-search-plus"></i></button>
    <button onclick="zoomOut(this)" title="Zoom Out"><i class="fas fa-search-minus"></i></button>
    <button onclick="resetZoom(this)" title="Reset"><i class="fas fa-expand"></i></button>
  </div>
  <div class="diagram-container">
    <pre class="mermaid">${diagram}</pre>
  </div>
</div>`;
}

function keyPoints(items) {
  return `
<div class="key-points">
  <h3><i class="fas fa-lightbulb"></i> Key Points</h3>
  <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
</div>`;
}

function infoBox(title, items) {
  return `
<div class="info-box">
  <h3><i class="fas fa-circle-info"></i> ${title}</h3>
  <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
</div>`;
}

function unitNav(subj, unit) {
  const prevUrl = unit.id > 1 ? `topic-${subj.id}-u${unit.id - 1}-t1.html` : (subj.semester === 1 ? 'semester1.html' : `semester${subj.semester}.html`);
  const nextTopic = `topic-${subj.id}-u${unit.id}-t${Math.min(unit.topics.length, unit.topics.length)}.html`;
  const nextUnit = unit.id < subj.units.length ? `topic-${subj.id}-u${unit.id + 1}-t1.html` : `subject-${subj.id}-act-u${unit.id}.html`;
  return `
<div class="unit-nav">
  <a href="${prevUrl}" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Prev</a>
  <div class="nav-group">
    <a href="subject-${subj.id}-pyq-u${unit.id}.html" class="btn btn-outline"><i class="fas fa-bullseye"></i> Repeated Q's</a>
    <a href="subject-${subj.id}-act-u${unit.id}.html" class="btn btn-primary"><i class="fas fa-play"></i> Activity</a>
  </div>
</div>`;
}

/* ---------------- page builders ---------------- */

function buildSubjectHub(subj) {
  const unitCards = subj.units.map((u) => {
    const topicLinks = u.topics.map((t) =>
      `<a href="topic-${subj.id}-u${u.id}-t${t.n.split('.')[1] || t.n}.html"><span class="num">${t.n}</span> ${esc(t.title)}</a>`).join('');
    return `
    <div class="content-section">
      <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-layer-group"></i> Unit ${u.id}: ${esc(u.title)}</h2>
      <p class="muted small" style="margin-bottom:.8rem">${esc(u.summary)}</p>
      <h3 style="font-size:.95rem;color:var(--text-secondary)">Topics in this unit</h3>
      <div class="topic-toc" style="margin-top:.5rem">
        <div class="topic-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.6rem;list-style:none;padding:0">
          ${u.topics.map((t) => `<div><a href="topic-${subj.id}-u${u.id}-t${t.n.split('.')[1] || t.n}.html"><span class="num">${t.n}</span> ${esc(t.title)}</a></div>`).join('')}
        </div>
      </div>
      <div class="tags mt-2">
        <a class="btn btn-sm btn-outline" href="subject-${subj.id}-act-u${u.id}.html"><i class="fas fa-play"></i> Activity</a>
        <a class="btn btn-sm btn-outline" href="subject-${subj.id}-pyq-u${u.id}.html"><i class="fas fa-bullseye"></i> Repeated Questions</a>
        <a class="btn btn-sm btn-outline" href="subject-${subj.id}-pyq-overall.html"><i class="fas fa-list-ol"></i> Overall PYQ</a>
      </div>
    </div>`;
  }).join('');

  const objHTML = `<ul>${subj.objectives.map((o) => `<li>${o}</li>`).join('')}</ul>`;
  const outHTML = `<ul>${subj.outcomes.map((o) => `<li>${o}</li>`).join('')}</ul>`;
  const books = `<ul>${subj.textbooks.map((b) => `<li>${b}</li>`).join('')}</ul>`;
  const refs = `<ul>${subj.references.map((b) => `<li>${b}</li>`).join('')}</ul>`;

  const html = `${head(subj.title, subj.title + ' — unit-wise topics, JNTU repeated questions and activities', mermaidInit())}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Semester ${subj.semester}`, href: `semester${subj.semester}.html` }, { label: subj.short }])}
<header class="unit-header" style="--unit-color:var(--c${subj.color})">
  <span class="unit-badge">${subj.code}</span>
  <h1>${esc(subj.title)}</h1>
  <p class="unit-subtitle">${esc(subj.subtitle)}</p>
  <div class="meta">
    <span><i class="fas fa-layer-group"></i>${subj.units.length} Units</span>
    <span><i class="fas fa-tags"></i>${subj.category}</span>
    <span><i class="fas fa-book"></i>${subj.credits} Credits</span>
  </div>
</header>
<div class="content-container">
  <div class="content-section">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-bullseye"></i> Course Objectives</h2>
    ${objHTML}
  </div>
  <div class="content-section">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-star"></i> Course Outcomes</h2>
    <p class="small muted mb-2">After completing this course, a student will be able to:</p>
    ${outHTML}
  </div>
  <div class="content-section">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-list-check"></i> Unit-wise Topics</h2>
    ${unitCards}
  </div>
  <div class="content-section">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-trophy"></i> Overall Repeated Questions</h2>
    <p class="small muted mb-2">The most frequently asked JNTU questions across the whole subject — ideal for final revision.</p>
    <a class="btn btn-warning" style="background:var(--warning);border-color:var(--warning);color:#fff" href="subject-${subj.id}-pyq-overall.html"><i class="fas fa-list-ol"></i> Open Overall PYQ</a>
  </div>
  <div class="content-section">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-book-open"></i> Text Books</h2>
    ${books}
    <h3 style="margin-top:1.2rem;font-size:.95rem;color:var(--text-secondary)">Reference Books</h3>
    ${refs}
  </div>
  <div style="text-align:center;margin-top:1rem">
    <a href="subject-${subj.id}-act-u1.html" class="btn btn-primary btn-lg"><i class="fas fa-play"></i> Start Unit 1 Activity</a>
    <a href="subject-${subj.id}-pyq-overall.html" class="btn btn-outline btn-lg"><i class="fas fa-bullseye"></i> Overall Repeated Questions</a>
  </div>
</div>
${FOOTER}
<script src="script.js"></script>
</body>
</html>`;
  writeFile('subject-' + subj.id + '.html', html);
  // Build hub routing links (subject hub is the main subject page)
}

function buildUnitTopicPage(subj, unit, topic) {
  const tNum = parseInt(topic.n.split('.')[1] || topic.n, 10);
  const prevTopic = tNum > 1 ? `topic-${subj.id}-u${unit.id}-t${tNum - 1}.html`
    : (unit.id > 1 ? `topic-${subj.id}-u${unit.id - 1}-t${(subj.units[unit.id - 2].topics.length)}.html` : null);
  const nextStart = tNum < unit.topics.length ? `topic-${subj.id}-u${unit.id}-t${tNum + 1}.html`
    : (unit.id < subj.units.length ? `topic-${subj.id}-u${unit.id + 1}-t1.html` : `subject-${subj.id}-act-u${unit.id}.html`);

  // Build topic content: paragraphs, list, diagram, keypoints
  let body = '';
  (topic.content || []).forEach((blk) => {
    if (blk.type === 'p') body += `<p>${blk.text}</p>`;
    else if (blk.type === 'h') body += `<h3><i class="fas fa-angles-right"></i> ${blk.text}</h3>`;
    else if (blk.type === 'ul') body += `<ul>${blk.items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    else if (blk.type === 'ol') body += `<ol>${blk.items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    else if (blk.type === 'points') body += keyPoints(blk.items);
    else if (blk.type === 'info') body += infoBox(blk.title, blk.items);
    else if (blk.type === 'diagram') body += diagramBlock(blk.mermaid);
    else if (blk.type === 'code') body += `<pre class="code-block">${blk.text}</pre>`;
  });
  if (!body) body = `<p>Details covered in the unit syllabus for this topic.</p>`;

  const topicsToc = unit.topics.map((t) => {
    const tn = parseInt(t.n.split('.')[1] || t.n, 10);
    const active = tn === tNum ? ' style="border-color:var(--c'+subj.color+');background:var(--bg-hover)"' : '';
    return `<li><a href="topic-${subj.id}-u${unit.id}-t${tn}.html"${active}><span class="num">${t.n}</span> ${esc(t.title)}</a></li>`;
  }).join('');

  const nav = `
  <div class="unit-nav">
    ${prevTopic ? `<a href="${prevTopic}" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Prev</a>` : '<span></span>'}
    <div class="nav-group">
      <a href="subject-${subj.id}-pyq-u${unit.id}.html" class="btn btn-outline"><i class="fas fa-bullseye"></i> Repeated Q's</a>
      <a href="subject-${subj.id}-act-u${unit.id}.html" class="btn btn-primary"><i class="fas fa-play"></i> Activity</a>
    </div>
    <a href="${nextStart}" class="btn btn-secondary">Next <i class="fas fa-arrow-right"></i></a>
  </div>`;

  const html = `${head(`${subj.short} · Unit ${unit.id} · ${topic.n} ${topic.title}`, `${subj.title} Unit ${unit.id} topic ${topic.n}: ${topic.title}`, mermaidInit())}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Sem ${subj.semester}`, href: `semester${subj.semester}.html` }, { label: subj.short, href: `subject-${subj.id}.html` }, { label: `Unit ${unit.id}`, href: `subject-${subj.id}.html` }, { label: `${topic.n}` }])}
<header class="unit-header" style="--unit-color:var(--c${subj.color})">
  <span class="unit-badge">Unit ${unit.id} &middot; Topic ${topic.n}</span>
  <h1>${esc(topic.title)}</h1>
  <p class="unit-subtitle">${esc(subj.short)} — ${esc(unit.title)}</p>
</header>
<div class="content-container">
  <div class="topic-toc">
    <h3><i class="fas fa-list"></i> ${esc(unit.title)}</h3>
    <div class="topic-list" style="list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.6rem">
      ${topicsToc}
    </div>
  </div>
  <div class="content-section animate-fadeIn">
    <h2 style="--unit-color:var(--c${subj.color})"><i class="fas fa-file-lines"></i> ${esc(topic.title)}</h2>
    ${body}
    <div class="info-box" style="margin-top:1.5rem">
      <h3><i class="fas fa-hourglass-half"></i> Learning Tip</h3>
      <ul>
        <li>Spend 15–20 minutes on this topic.</li>
        <li>Then attempt the <a href="subject-${subj.id}-act-u${unit.id}.html">unit activity</a> to check your understanding.</li>
        <li>Review the <a href="subject-${subj.id}-pyq-u${unit.id}.html">repeated questions</a> for this unit to focus on exam priorities.</li>
      </ul>
    </div>
  </div>
  ${nav}
</div>
${FOOTER}
<script src="script.js"></script>
</body>
</html>`;
  writeFile(`topic-${subj.id}-u${unit.id}-t${tNum}.html`, html);
}

/* ---- Activity page ---- */
function buildActivityPage(subj, unit) {
  // Pick questions for this unit
  const questions = (unit.questions || unit.pyq || []).map((p, i) => {
    // Build a quiz question from pyq
    return { q: p.q, correct: p.a || 0, options: p.options, explanation: p.explanation, type: 'mcq' };
  }).slice(0, 30);

  // If fewer than 30, we still ship what we have; engine supports any count.

  const qJSON = JSON.stringify(questions).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  const html = `${head(`${subj.short} · Unit ${unit.id} Activity`, `Activity quiz for ${subj.title} Unit ${unit.id}`, '')}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Sem ${subj.semester}`, href: `semester${subj.semester}.html` }, { label: subj.short, href: `subject-${subj.id}.html` }, { label: `Unit ${unit.id}`, href: `subject-${subj.id}.html` }, { label: 'Activity' }])}
<main class="activity-container">
  <div class="activity-header">
    <h1><i class="fas fa-tasks"></i> Unit ${unit.id} Activity</h1>
    <p>${esc(subj.title)} · ${esc(unit.title)}</p>
    <p class="small muted">Answer the ${questions.length} questions. Score at least 40% to pass and unlock the next unit.</p>
  </div>
  <div class="progress-wrapper">
    <div class="progress-bar"><div class="progress-fill" id="progressBar"></div></div>
    <div class="progress-text"><span id="answeredCount">0 / ${questions.length} answered</span><span id="scoreDisplay">Score: 0</span></div>
  </div>
  <div class="quiz-container" id="quizContainer"></div>
  <div class="quiz-nav" id="quizNav">
    <button class="btn btn-secondary" id="prevBtn"><i class="fas fa-arrow-left"></i> Prev</button>
    <button class="btn btn-primary" id="nextBtn" disabled><i class="fas fa-arrow-right"></i> Next</button>
  </div>
</main>
${FOOTER}
<script src="script.js"></script>
<script>
  (function () {
    var questions = ${qJSON};
    QuizEngine.setMeta('${subj.id}', ${unit.id});
    QuizEngine.returnHref = 'subject-${subj.id}-act-u${unit.id}.html';
    QuizEngine.init(questions, { shuffleQuestions: true, shuffleOptions: false });
    // Guard: if fewer than 1 question, show message
    if (!questions.length) {
      document.getElementById('quizContainer').innerHTML = '<div class="results-panel"><h3>No questions available yet.</h3><a class="btn btn-primary" href="subject-${subj.id}.html">Back to Subject</a></div>';
    }
  })();
</script>
</body>
</html>`;
  writeFile(`subject-${subj.id}-act-u${unit.id}.html`, html);
}

/* ---- PYQ page per unit ---- */
function buildPyqUnitPage(subj, unit) {
  const items = (unit.pyq || []).map((p) => {
    const freqBadge = p.freq >= 4 ? `<div class="freq-badge">🔴 Repeated ${p.freq}+ times</div>` :
      (p.freq >= 2 ? `<div class="freq-badge" style="background:var(--warning-bg);color:var(--warning)">Repeated ${p.freq} times</div>` : '');
    return `
    <div class="pyq-item ${p.freq >= 4 ? 'frequent' : ''}">
      ${freqBadge}
      <div class="q">${esc(p.q)}</div>
      <div class="marks">Marks: ${p.marks || '2/5/10'} &middot; Likely: ${esc(p.type || 'Short/Long Answer')}</div>
    </div>`;
  }).join('');

  const html = `${head(`${subj.short} · Unit ${unit.id} Repeated Questions`, `Most repeated JNTU questions for ${subj.title} Unit ${unit.id}`)}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Sem ${subj.semester}`, href: `semester${subj.semester}.html` }, { label: subj.short, href: `subject-${subj.id}.html` }, { label: `Unit ${unit.id}`, href: `subject-${subj.id}.html` }, { label: 'Repeated Questions' }])}
<header class="unit-header" style="--unit-color:var(--c${subj.color})">
  <span class="unit-badge">Unit ${unit.id}</span>
  <h1><i class="fas fa-bullseye"></i> Repeated Questions</h1>
  <p class="unit-subtitle">${esc(subj.title)} — ${esc(unit.title)}</p>
</header>
<div class="content-container">
  <div class="pyq-stage">
    <h2><i class="fas fa-fire"></i> Most Asked Questions (Unit ${unit.id}) <span class="stage-badge">FOCUS HERE</span></h2>
    <p class="small muted mb-2">These are the questions most frequently repeated in JNTU examinations for this unit. Master these first.</p>
    ${items || '<p>No repeated questions recorded yet.</p>'}
  </div>
  <div class="info-box">
    <h3><i class="fas fa-bullhorn"></i> How to prepare</h3>
    <ul>
      <li>Write full-length answers for the "Repeated 4+ times" questions — they are near-guaranteed.</li>
      <li>Prepare a 1-page summary for each repeated question.</li>
      <li>Then test yourself in the <a href="subject-${subj.id}-act-u${unit.id}.html">unit activity</a>.</li>
    </ul>
  </div>
  <div class="unit-nav" style="padding:0">
    <a href="topic-${subj.id}-u${unit.id}-t1.html" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> View Topics</a>
    <div class="nav-group">
      <a href="subject-${subj.id}-pyq-overall.html" class="btn btn-outline"><i class="fas fa-list-ol"></i> Overall PYQ</a>
      <a href="subject-${subj.id}-act-u${unit.id}.html" class="btn btn-primary"><i class="fas fa-play"></i> Activity</a>
    </div>
  </div>
</div>
${FOOTER}
<script src="script.js"></script>
</body>
</html>`;
  writeFile(`subject-${subj.id}-pyq-u${unit.id}.html`, html);
}

/* ---- PYQ overall page ---- */
function buildPyqOverall(subj) {
  const stages = subj.units.map((u, idx) => {
    const items = (u.pyq || []).map((p) => {
      const c = p.freq >= 4 ? 'frequent' : '';
      const badge = p.freq >= 4 ? `<div class="freq-badge">🔴 ${p.freq}+ times</div>` : (p.freq >= 2 ? `<div class="freq-badge" style="background:var(--warning-bg);color:var(--warning)">${p.freq} times</div>` : '');
      return `<div class="pyq-item ${c}">${badge}<div class="q">${esc(p.q)}</div><div class="marks">Marks: ${p.marks || '5'} &middot; Unit ${u.id}</div></div>`;
    }).join('');
    return `
    <div class="pyq-stage">
      <h2><i class="fas fa-layer-group"></i> Unit ${u.id}: ${esc(u.title)}</h2>
      ${items || '<p class="muted">No repeated questions recorded.</p>'}
    </div>`;
  }).join('');

  // Overall top questions (all units mixed)
  const allQ = subj.units.flatMap((u) => (u.pyq || []).map((p) => ({ ...p, unit: u.id })))
    .sort((a, b) => (b.freq || 0) - (a.freq || 0));
  const overall = allQ.map((p) => {
    const c = p.freq >= 4 ? 'frequent' : '';
    const badge = p.freq >= 4 ? `<div class="freq-badge">🔴 ${p.freq}+ times</div>` : '';
    return `<div class="pyq-item ${c}">${badge}<div class="q">${esc(p.q)}</div><div class="marks">Unit ${p.unit} &middot; Marks: ${p.marks || '5'}</div></div>`;
  }).join('');

  const html = `${head(`${subj.short} · Overall Repeated Questions`, `Most repeated JNTU questions for the whole subject ${subj.title}`)}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Sem ${subj.semester}`, href: `semester${subj.semester}.html` }, { label: subj.short, href: `subject-${subj.id}.html` }, { label: 'Overall Repeated Questions' }])}
<header class="unit-header" style="--unit-color:var(--c${subj.color})">
  <span class="unit-badge">Subject-wide</span>
  <h1><i class="fas fa-trophy"></i> Overall Repeated Questions</h1>
  <p class="unit-subtitle">${esc(subj.title)} — the most asked JNTU questions across all units.</p>
</header>
<div class="content-container">
  <div class="pyq-stage">
    <h2><i class="fas fa-crown"></i> Top Overall Questions <span class="stage-badge">MUST REVISE</span></h2>
    <p class="small muted mb-2">Sorted by frequency of appearance in JNTU examinations.</p>
    ${overall || '<p>No overall questions recorded.</p>'}
  </div>
  ${stages}
</div>
${FOOTER}
<script src="script.js"></script>
</body>
</html>`;
  writeFile(`subject-${subj.id}-pyq-overall.html`, html);
}

/* ---- Semester page builder (shared) ---- */
function buildSemesterPage(idx) {
  const sem = semestersMeta[idx];
  const subjects = SUBJECTS.filter((s) => s.semester === idx + 1);
  const cards = subjects.map((s) => {
    const badge = s.category === 'Core' ? 'core' : (s.category === 'Lab' ? 'lab' : 'elec');
    return `
    <div class="card unit-card" onclick="location.href='subject-${s.id}.html'">
      <div class="card-icon c-${s.color}"><i class="fas ${s.icon}"></i></div>
      <h3>${esc(s.title)}</h3>
      <p class="sub">${esc(s.short)}</p>
      <div class="tags"><span class="tag ${badge}">${esc(s.category)}</span><span class="tag">${s.units.length} units</span><span class="tag">${s.credits} cr</span></div>
    </div>`;
  }).join('');

  const html = `${head(`${sem.title} | M.Tech CSE`, `${sem.title} subjects`)}
<body>
${NAV}
${breadcrumb([{ label: 'Home', href: 'index.html' }, { label: `Semester ${idx + 1}` }])}
<header class="unit-header" style="--unit-color:var(--c${(idx % 4) + 1})">
  <span class="unit-badge">Semester ${idx + 1}</span>
  <h1>${sem.title}</h1>
  <p class="unit-subtitle">${sem.desc}</p>
</header>
<div class="container">
  <div class="card-grid">${cards}</div>
  <div class="info-box mt-3">
    <h3><i class="fas fa-info-circle"></i> How to start</h3>
    <p>Open a subject to see its <strong>units</strong> and the <strong>individual topics (1.1–1.5)</strong> inside each unit. Complete each unit's activity to track progress.</p>
  </div>
</div>
${FOOTER}
<script src="script.js"></script>
</body>
</html>`;
  writeFile(`semester${idx + 1}.html`, html);
}

const semestersMeta = [
  { title: 'I Year &middot; Semester I', desc: 'Foundations: Mathematics, Data Structures &amp; Algorithms, Big Data, Networks, OOSE and Research Methodology.' },
  { title: 'I Year &middot; Semester II', desc: 'Machine Learning, MEAN Stack Technologies, Advanced Databases &amp; Mining, Cloud Computing, Security and Soft Computing.' },
  { title: 'II Year &middot; Semester I', desc: 'Deep Learning, Social Network Analysis, Open Electives and Dissertation-I.' },
  { title: 'II Year &middot; Semester II', desc: 'Dissertation-II: research, implementation, report and viva-voce.' },
];

function writeFile(name, content) {
  const file = join(ROOT, name);
  writeFileSync(file, content);
  console.log('  ✓', name);
}

/* ---------------- main ---------------- */
console.log('Generating pages for', SUBJECTS.length, 'subjects...');
SUBJECTS.forEach((s) => {
  console.log('\nSubject:', s.id, s.title);
  buildSubjectHub(s);
  s.units.forEach((u) => {
    u.topics.forEach((t) => buildUnitTopicPage(s, u, t));   // separate topic pages 1.1..1.5
    buildActivityPage(s, u);                                 // per-unit activity
    buildPyqUnitPage(s, u);                                  // per-unit repeated Q's
  });
  buildPyqOverall(s);                                        // overall repeated Q's
});

for (let i = 0; i < 4; i++) {
  console.log('\nSemester page', i + 1);
  buildSemesterPage(i);
}

console.log('\nDone.');
