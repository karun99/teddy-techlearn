/**
 * Teddy Widget — floating AI companion injected into every TechLearn page.
 * Vanilla JS, zero dependencies, injected without touching page HTML (FR-105).
 * Tabs: Chat · Quiz · Notes.  Settings: provider / language / erasure.
 */
(function () {
  'use strict';

  /* ---------------- configuration ---------------- */
  const LS = { learner: 'tw_learner_id', provider: 'tw_provider', lang: 'tw_lang', dismiss: 'tw_dismissed_session', aiCfg: 'tw_aiconfig', byok: 'tw_byok_keys' };
  const BYOK_PROVIDERS = ['gemini', 'openrouter', 'openai', 'anthropic', 'groq']; // ollama is local, no key

  const OFF = window.location.protocol === 'file:';
  const API = OFF ? null : (window.location.origin + '/api');
  const SUBJECTS = {};
  const T = { en: 'Teddy', hi: 'टेडी' };

  /* ---------------- small utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }
  function uuid() {
    try { return crypto.randomUUID(); } catch { return 'tw-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  }
  function learnerId() {
    let id = localStorage.getItem(LS.learner);
    if (!id) { id = uuid(); localStorage.setItem(LS.learner, id); }
    return id;
  }
  function stGet(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } }
  function stSet(k, v) {
    try { sessionStorage.setItem(k, v); if (k === 'tw_provider' || k === 'tw_lang') localStorage.setItem(k, v); } catch { /* ignore */ }
  }
  function lang() { return stGet(LS.lang) || 'en'; }
  function isAi() { return navigator.userAgent.includes('AI') || navigator.userAgent.includes('GPTBot'); }

  /* ---- per-user AI configuration (AI-CONFIG) ---- */
  function defaultAiCfg() { return { provider: '', model: '', temperature: 0.4, maxTokens: 900 }; }
  function readAiCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS.aiCfg) || 'null');
      if (raw && typeof raw === 'object') return { ...defaultAiCfg(), ...raw };
    } catch { /* fall through */ }
    return defaultAiCfg();
  }
  function writeAiCfg(cfg) { try { localStorage.setItem(LS.aiCfg, JSON.stringify(cfg)); } catch { /* ignore */ } }
  function readKeys() {
    try { return JSON.parse(localStorage.getItem(LS.byok) || '{}') || {}; } catch { return {}; }
  }
  function writeKeys(map) { try { localStorage.setItem(LS.byok, JSON.stringify(map)); } catch { /* ignore */ } }
  function maskKey(k) { return k && k.length > 8 ? k.slice(0, 3) + '…' + k.slice(-4) : '(empty)'; }

  async function fetchJson(path, opts, timeoutMs = 70000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(API + path, {
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
      return data;
    } finally { clearTimeout(t); }
  }

  /* ---------------- Markdown-lite renderer (XSS-safe) ---------------- */
  function inline(s) {
    return escapeMarkdown(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([a-zA-Z0-9_\-./:#%?=&]+)\)/g, (m, t, u) =>
        /^javascript:/i.test(u) ? t : `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`
      );
  }
  function escapeMarkdown(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function md(src) {
    const text = String(src || '');
    const blocks = [];
    let codeBuf = [];
    let inCode = false;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (inCode) {
          blocks.push('<pre class="tw-code">' + escapeMarkdown(codeBuf.join('\n')) + '</pre>');
          codeBuf = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }
      if (/^###? /.test(line.trim())) { blocks.push('<div class="tw-h">' + inline(line.trim().replace(/^###? /, '')) + '</div>'); continue; }
      if (/^> ?/.test(line.trim())) { blocks.push('<div class="tw-quote">' + inline(line.trim().replace(/^> ?/, '')) + '</div>'); continue; }
      if (/^[-*] /.test(line.trim())) { blocks.push('<div class="tw-li">• ' + inline(line.trim().replace(/^[-*] /, '')) + '</div>'); continue; }
      if (/^\d+\. /.test(line.trim())) { blocks.push('<div class="tw-li">' + inline(line.trim()) + '</div>'); continue; }
      if (/^---+$/.test(line.trim())) { blocks.push('<hr>'); continue; }
      blocks.push(inline(line));
    }
    if (codeBuf.length) blocks.push('<pre class="tw-code">' + escapeMarkdown(codeBuf.join('\n')) + '</pre>');
    const html = blocks.join('\n').replace(/\n/g, '<br>');
    return html;
  }

  /* ---------------- page context ---------------- */
  let CONTEXT = { page: '', subjectId: '', unit: '', topic: '', subjectTitle: '' };
  function detectContext() {
    const path = (window.location.pathname.split('/').pop() || '').split('?')[0];
    const m = path.match(/^(topic|subject)-([a-z0-9]+)(?:-u(\d+)-t(\d+)|-u(\d+))?.*$/);
    const h1 = document.querySelector('h1');
    const title = h1 ? h1.textContent.trim() : (document.title || '').split('|')[0].trim();
    if (m) {
      const [, type, subj, topicU, topicT, actU] = m;
      const subjCode = subj;
      CONTEXT = {
        page: path,
        subjectId: subjCode,
        subjectTitle: title || subjCode,
        unit: topicU || actU ? 'Unit ' + (topicU || actU) : '',
        topic: topicT ? 'Topic ' + topicT : '',
      };
    } else {
      CONTEXT = { page: path, subjectId: '', unit: '', topic: '', subjectTitle: title };
    }
    return CONTEXT;
  }

  /* ---------------- state ---------------- */
  const state = {
    open: false, provider: '', status: 'off',
    aiConfig: null,
    chat: { msgs: [], history: [], busy: false },
    quiz: { data: null, answers: {}, flags: new Set(), hints: 0, cur: 0, timer: null, remain: 0 },
    notes: { template: 'cornell', current: null },
  };

  /* ---------------- DOM ---------------- */
  let fab, panel, tabChat, tabQuiz, tabNotes, tabSettingsStrip;
  let chatMsgs, chatInput, chatSend, statusBar;
  let quizStage, notesStage;

  /* ---------------- status ---------------- */
  function setStatus(ok, msg) {
    statusBar.className = 'tw-' + (ok ? 'on' : 'off');
    statusBar.innerHTML = '<span class="tw-dot"></span><span>' + esc(msg) + '</span>';
  }

  /* ---------------- chat ---------------- */
  function addMsg(text, who, extra) {
    const bubble = el('div', 'tw-msg ' + (who === 'user' ? 'tw-msg-user' : 'tw-msg-tw'));
    bubble.innerHTML = who === 'user' ? esc(text) : md(text);
    if (extra && extra.src) bubble.appendChild(el('div', 'tw-src', '· ' + inline(extra.src)));
    chatMsgs.appendChild(bubble);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  function greet() {
    const c = CONTEXT;
    const hi = lang() === 'hi' ? 'नमस्ते' : 'Hi';
    if (c.subjectId) {
      addMsg(hi + '! I\'m ' + T[lang()] + ' 🧸. Ready to tackle ' + (c.subjectTitle || c.subjectId) +
        (c.unit ? ' · ' + c.unit + (c.topic ? ' (' + c.topic + ')' : '') : '') +
        '? Ask me to explain, run a timed quiz, or jot notes.');
    } else {
      addMsg(hi + '! I\'m ' + T[lang()] + ' 🧸, your M.Tech CSE study companion. Open any subject/topic page and I\'ll anchor my help there. Or pick a subject and start a quiz!');
    }
  }

  async function handleSend() {
    const msg = chatInput.value.trim();
    if (!msg || state.chat.busy) return;
    addMsg(msg, 'user');
    chatInput.value = '';
    chatInput.style.height = '';
    chatSend.disabled = true;
    chatSend.innerHTML = '<span class="tw-spinner"></span>';
    state.chat.busy = true;
    state.chat.history.push({ role: 'user', content: lang() === 'hi' ? msg + ' (respond in Hindi/Hinglish)' : msg });
    try {
      const cfg = state.aiConfig || defaultAiCfg();
      const activeProvider = cfg.provider || state.provider || '';
      const keys = readKeys();
      const data = await fetchJson('/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: msg,
          pageContext: CONTEXT,
          learnerId: learnerId(),
          provider: activeProvider,
          history: state.chat.history.slice(-14, -1),
          aiConfig: {
            provider: activeProvider,
            model: cfg.model,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            apiKey: activeProvider ? (keys[activeProvider] || '') : '',
            apiKeyProvider: activeProvider,
          },
        }),
      });
      const reply = data.reply || 'No reply.';
      state.chat.history.push({ role: 'assistant', content: reply });
      if (data.mode === 'offline' || data.mode === 'degraded') {
        setStatus(false, 'AI provider offline — showing grounded TechLearn summary');
      } else if (data.provider) {
        setStatus(true, 'via ' + (data.provider || 'llm'));
      }
      addMsg(reply, 'teddy', data.topHit ? { src: 'Source: ' + data.topHit.title } : null);
      if (data.topHit && data.topHit.page) {
        addMsg('📖 [Open the full topic page → ' + data.topHit.title + '](' + data.topHit.page + ')', 'teddy');
      }
    } catch (err) {
      setStatus(false, 'API unreachable');
      addMsg('⚠️ The AI service is unreachable right now. The TechLearn pages on this site always work offline. Try again in a moment. 🧸', 'teddy');
      state.chat.history.push({ role: 'assistant', content: 'Service temporarily unavailable.' });
    } finally {
      state.chat.busy = false;
      chatSend.disabled = false;
      chatSend.innerHTML = '➤';
      chatInput.focus();
    }
  }

  /* ---------------- quiz ---------------- */
  function fillSubjects(select, selected) {
    select.innerHTML = '';
    const ids = Object.keys(SUBJECTS);
    if (!ids.length) {
      select.appendChild(new Option('(loading…)', ''));
      return;
    }
    for (const id of ids) select.appendChild(new Option(SUBJECTS[id].title + ' (' + id + ')', id));
    if (selected && SUBJECTS[selected]) select.value = selected;
  }

  function renderQuizConfig() {
    quizStage.innerHTML = '';
    const c = CONTEXT;
    const form = el('div', 'tw-form');
    form.innerHTML = `
      <div class="tw-field"><label>Subject</label>
        <select id="twQSubj">${Object.keys(SUBJECTS).map((id) => `<option value="${id}">${esc(SUBJECTS[id].title)} (${id})</option>`).join('')}</select></div>
      <div class="tw-field"><label>Unit</label>
        <select id="twQUnit">${[1,2,3,4,5].map((n) => `<option value="${n}">Unit ${n}</option>`).join('')}</select></div>
      <div class="tw-field"><label>Quiz type</label>
        <select id="twQKind"><option value="mcq">MCQ (auto-graded)</option><option value="pyq">Previous Year Questions (self-assessed)</option></select></div>
      <div class="tw-field"><label>Duration (minutes)</label>
        <select id="twQDur"><option value="5">5</option><option value="10">10</option><option value="15" selected>15</option><option value="30">30</option></select></div>
      <div class="tw-btn-group">
        <button class="tw-btn tw-btn-primary" id="twQStart">Start quiz</button>
      </div>
      <p class="tw-hint">Questions come from TechLearn's unit activity & PYQ banks (subject-*-act-uN.html / -pyq-uN.html).</p>`;
    quizStage.appendChild(form);
    const s = $('#twQSubj', form);
    if (c.subjectId) s.value = c.subjectId;
    const u = $('#twQUnit', form);
    const um = String(c.unit).match(/(\d+)/);
    if (um) u.value = um[1];
    $('#twQStart', form).addEventListener('click', startQuiz);
  }

  async function startQuiz() {
    const subject = $('#twQSubj').value, unit = $('#twQUnit').value,
      kind = $('#twQKind').value, duration = parseInt($('#twQDur').value, 10);
    if (!subject) { setStatus(false, 'pick a subject'); return; }
    quizStage.innerHTML = '<div class="tw-result"><span class="tw-spinner"></span> Preparing quiz…</div>';
    try {
      const data = await fetchJson('/quiz', {
        method: 'POST',
        body: JSON.stringify({ subject, unit, kind, duration, count: 10, learnerId: learnerId() }),
      });
      state.quiz = {
        meta: data, answers: {}, flags: new Set(), hints: 0, cur: 0,
        remain: data.durationSec, timer: null,
      };
      renderQuizQ();
      startTimer();
    } catch (err) {
      quizStage.innerHTML = '<div class="tw-result"><p>Could not load quiz.</p></div>';
      setStatus(false, err.message);
    }
  }

  function startTimer() {
    clearInterval(state.quiz.timer);
    state.quiz.timer = setInterval(() => {
      state.quiz.remain -= 1;
      if (state.quiz.remain <= 0) { clearInterval(state.quiz.timer); submitQuiz(); return; }
      const tr = $('#twTimer');
      if (tr) tr.textContent = fmtTime(state.quiz.remain);
    }, 1000);
  }

  function fmtTime(s) {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return m + ':' + ss;
  }

  function renderQuizQ() {
    const qz = state.quiz.data.questions;
    const q = qz[state.quiz.cur];
    quizStage.innerHTML = '';
    const wrap = el('div', 'tw-quiz-stage');
    const top = el('div', 'tw-quiz-top');
    top.innerHTML = `<span class="tw-count">Q ${state.quiz.cur + 1} / ${qz.length}</span>
      <span class="tw-timer" id="twTimer">${fmtTime(state.quiz.remain)}</span>
      <span class="tw-flag ${state.quiz.flags.has(q.id) ? 'tw-flagged' : ''}" id="twFlagBtn">🚩</span>`;
    wrap.appendChild(top);

    const card = el('div', 'tw-quiz-stage').classList;
    const cardEl = el('div');
    cardEl.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-bottom:10px';
    cardEl.appendChild(el('div', '', esc(q.q)));
    if (q.type === 'mcq' && q.options && q.options.length) {
      q.options.forEach((opt, idx) => {
        const b = el('button', 'tw-opt' + (state.quiz.answers[q.id] === idx ? ' tw-sel' : ''), indexLabel(idx) + ' ' + esc(opt));
        b.addEventListener('click', () => {
          state.quiz.answers[q.id] = idx;
          renderQuizQ();
        });
        cardEl.appendChild(b);
      });
      // hint button with penalty (FR-705)
      const hintRow = el('div', 'tw-btn-group tw-hint');
      const hintBtn = el('button', 'tw-btn tw-btn-sm', '💡 Hint (−1 min)');
      hintBtn.addEventListener('click', () => {
        state.quiz.hints += 1;
        state.quiz.remain = Math.max(0, state.quiz.remain - 60);
        hintBtn.disabled = true;
        hintBtn.textContent = 'Hint: remove the two least-likely options';
      });
      hintRow.appendChild(hintBtn);
      cardEl.appendChild(hintRow);
    } else {
      // PYQ: self-assessed
      const ta = el('textarea');
      ta.style.cssText = 'width:100%;min-height:80px;border:1px solid #e5e7eb;border-radius:10px;padding:8px;font-size:13px';
      ta.placeholder = 'Write your answer here (not graded — for your practice)…';
      cardEl.appendChild(ta);
      const got = el('button', 'tw-btn' + (state.quiz.answers[q.id] === 'pass' ? ' tw-sel' : ''), '✓ I answered this');
      got.addEventListener('click', () => {
        state.quiz.answers[q.id] = state.quiz.answers[q.id] === 'pass' ? null : 'pass';
        renderQuizQ();
      });
      cardEl.appendChild(got);
    }
    wrap.appendChild(cardEl);

    const nav = el('div', 'tw-nav');
    const prev = el('button', 'tw-btn', '← Prev');
    prev.disabled = state.quiz.cur === 0;
    prev.addEventListener('click', () => { state.quiz.cur -= 1; renderQuizQ(); });
    const next = el('button', 'tw-btn tw-btn-primary', state.quiz.cur === qz.length - 1 ? 'Finish ✓' : 'Next →');
    next.addEventListener('click', () => {
      if (state.quiz.cur === qz.length - 1) submitQuiz();
      else { state.quiz.cur += 1; renderQuizQ(); }
    });
    nav.appendChild(prev); nav.appendChild(next);
    wrap.appendChild(nav);
    quizStage.appendChild(wrap);
    $('#twFlagBtn', wrap).addEventListener('click', () => {
      const id = qz[state.quiz.cur].id;
      if (state.quiz.flags.has(id)) state.quiz.flags.delete(id); else state.quiz.flags.add(id);
      renderQuizQ();
    });
  }

  function indexLabel(i) { return String.fromCharCode(65 + i) + '.'; }

  async function submitQuiz() {
    clearInterval(state.quiz.timer);
    const qz = state.quiz.data.questions;
    const answers = qz.map((q) => ({
      id: q.id,
      selected: state.quiz.answers[q.id] !== 'pass' ? state.quiz.answers[q.id] : null,
      selfScore: q.type === 'pyq' ? (state.quiz.answers[q.id] === 'pass' ? 'pass' : 'fail') : undefined,
    }));
    quizStage.innerHTML = '<div class="tw-result"><span class="tw-spinner"></span> Scoring…</div>';
    try {
      const data = await fetchJson('/quiz', {
        method: 'POST',
        body: JSON.stringify({ submit: true, subject: state.quiz.meta.path.split('-')[1], unit: state.quiz.meta.path.match(/u(\d)/)?.[1] || 1, quizId: state.quiz.meta.quizId, topic: state.quiz.meta.path, answers, questions: qz, timeUsedMs: state.quiz.meta.durationSec * 1000 - state.quiz.remain * 1000, hintUsage: { count: state.quiz.hints }, learnerId: learnerId() }),
      });
      renderQuizResults(data);
    } catch (err) {
      quizStage.innerHTML = '<div class="tw-result"><p>Could not submit.</p></div>';
    }
  }

  function renderQuizResults(data) {
    quizStage.innerHTML = '';
    const wrap = el('div', 'tw-result');
    const pct = data.accuracy || 0;
    wrap.appendChild(el('div', 'tw-score', pct + '%'));
    wrap.appendChild(el('div', 'tw-hint', 'Correct: ' + data.score + ' / ' + data.total));
    wrap.appendChild(el('div', '', '<span class="tw-pill ' + (data.pass ? 'tw-pill-pass' : 'tw-pill-fail') + '">' + (data.pass ? 'PASS — unit unlocked in TechLearn' : 'KEEP PRACTISING') + '</span>'));
    if (data.oi && data.oi.recommendation) wrap.appendChild(el('div', 'tw-hint', '🧠 ' + esc(data.oi.recommendation)));
    for (const r of data.results) {
      const box = el('div');
      box.style.cssText = 'text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0';
      box.appendChild(el('div', '', (r.correct ? '✅ ' : '❌ ') + esc(r.q)));
      if (r.explanation) box.appendChild(el('div', 'tw-hint', esc(r.explanation)));
      if (r.link) box.appendChild(el('div', 'tw-src', inline('[' + r.link + '](' + r.link + ')')));
      wrap.appendChild(box);
    }
    if (data.weakTopics && data.weakTopics.length) {
      wrap.appendChild(el('div', 'tw-hint', '📌 Weak areas now flagged in your learner graph (Teddy remembers next time).'));
    }
    const btns = el('div', 'tw-btn-group');
    btns.style.cssText = 'justify-content:center;margin-top:8px';
    const again = el('button', 'tw-btn', '↻ Retry');
    again.addEventListener('click', renderQuizConfig);
    const notes = el('button', 'tw-btn tw-btn-primary', '📝 Make notes on this unit');
    notes.addEventListener('click', () => { switchTab('notes'); });
    btns.appendChild(again); btns.appendChild(notes);
    wrap.appendChild(btns);
    quizStage.appendChild(wrap);
  }

  /* ---------------- notes ---------------- */
  function renderNotesForm() {
    notesStage.innerHTML = '';
    const c = CONTEXT;
    const form = el('div', 'tw-form');
    const subjectOptions = Object.keys(SUBJECTS).map((id) => `<option value="${id}">${esc(SUBJECTS[id].title)} (${id})</option>`).join('');
    form.innerHTML = `
      <div class="tw-field"><label>Subject</label><select id="twNSubj">${subjectOptions}</select></div>
      <div class="tw-field"><label>Unit</label><select id="twNUnit">${[1,2,3,4,5].map((n) => `<option value="${n}">Unit ${n}</option>`).join('')}</select></div>
      <div class="tw-field"><label>Topic (optional)</label><input id="twNTopic" type="text" placeholder="1–5, or blank for the whole unit"></div>
      <div class="tw-field"><label>Template</label>
        <select id="twNTmpl"><option value="cornell">Cornell</option><option value="outline">Outline</option><option value="flashcards">Flashcards</option></select></div>
      <div class="tw-field"><label>Your summary (optional, goes into the note)</label>
        <textarea id="twNSum" style="width:100%;min-height:60px;border:1px solid #e5e7eb;border-radius:10px;padding:8px;font-size:13px" placeholder="Write your own understanding — Teddy scaffolds the rest…"></textarea></div>
      <div class="tw-btn-group"><button class="tw-btn tw-btn-primary" id="twNGen">Generate notes</button></div>`;
    notesStage.appendChild(form);
    if (c.subjectId) $('#twNSubj', form).value = c.subjectId;
    const um = String(c.unit).match(/(\d+)/);
    if (um) $('#twNUnit', form).value = um[1];
    const tm = String(c.topic).match(/(\d+)/);
    if (tm) $('#twNTopic', form).value = tm[1];
    $('#twNGen', form).addEventListener('click', generateNotes);
  }

  async function generateNotes() {
    const subject = $('#twNSubj').value, unit = $('#twNUnit').value,
      topic = $('#twNTopic').value.trim(), template = $('#twNTmpl').value,
      learnerText = $('#twNSum').value.trim();
    if (!subject) { setStatus(false, 'pick a subject'); return; }
    notesStage.innerHTML = '<div class="tw-result"><span class="tw-spinner"></span> Generating…</div>';
    try {
      const data = await fetchJson('/notes', {
        method: 'POST',
        body: JSON.stringify({ subject, unit, topic: topic || undefined, template, learnerText }),
      });
      state.notes.current = { ...data.note, format: template, topicId: subject + '-' + unit + (topic ? '-t' + topic : '') };
      renderNotesEditor(data.note.content);
    } catch (err) {
      notesStage.innerHTML = '<div class="tw-result"><p>Could not generate notes.</p></div>';
    }
  }

  function renderNotesEditor(content) {
    notesStage.innerHTML = '';
    const stage = el('div', 'tw-form');
    stage.appendChild(el('div', 'tw-hint', 'Edit freely — notes are yours. Saved to your learner graph.'));
    stage.appendChild(el('textarea', '', content));
    const ta = $('textarea', stage);
    ta.id = 'twNotesText';
    ta.style.cssText = 'width:100%;min-height:240px;border:1px solid #e5e7eb;border-radius:12px;padding:10px;font-size:13px;font-family:ui-monospace,Menlo,monospace;line-height:1.5;resize:vertical';
    const btns = el('div', 'tw-btn-group');
    const save = el('button', 'tw-btn tw-btn-primary', '💾 Save to my graph');
    save.addEventListener('click', () => saveNote(ta.value));
    const dlMd = el('button', 'tw-btn', '⬇ Markdown'); dlMd.addEventListener('click', () => dl('markdown'));
    const dlCsv = el('button', 'tw-btn', '⬇ Anki CSV'); dlCsv.addEventListener('click', () => dl('anki-csv'));
    const dlJson = el('button', 'tw-btn', '⬇ JSON'); dlJson.addEventListener('click', () => dl('json'));
    if (state.notes.current.page) {
      stage.appendChild(el('div', 'tw-hint', inline('📖 Grounded in: [' + state.notes.current.page + '](' + state.notes.current.page + ')')));
    }
    btns.appendChild(save); btns.appendChild(dlMd); btns.appendChild(dlCsv); btns.appendChild(dlJson);
    stage.appendChild(btns);
    notesStage.appendChild(stage);
  }

  async function saveNote(content) {
    if (!state.notes.current) return;
    try {
      const data = await fetchJson('/notes', {
        method: 'POST',
        body: JSON.stringify({ save: true, learnerId: learnerId(), note: { ...state.notes.current, content } }),
      });
      if (data.saved) {
        setStatus(true, 'note saved to learner graph');
        renderNotesEditor(content);
        addMsg('✅ Note saved. I\'ll remember it across sessions. 🧸', 'teddy');
      }
    } catch (err) {
      setStatus(false, 'save failed');
    }
  }

  function dl(format) {
    if (!state.notes.current) return;
    fetchJson('/notes', { method: 'POST', body: JSON.stringify({ export: true, note: { ...state.notes.current, content: $('#twNotesText')?.value || '' }, format }) })
      .then((data) => {
        const blob = new Blob([data.content], { type: 'text/plain;charset=utf-8' });
        const a = el('a');
        a.href = URL.createObjectURL(blob);
        a.download = data.filename || 'teddy-notes.' + (format === 'json' ? 'json' : format === 'anki-csv' ? 'csv' : 'md');
        document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 100);
      })
      .catch(() => setStatus(false, 'export failed'));
  }

  /* ---------------- settings ---------------- */
  function providerOptions(includeOllama) {
    const opts = [];
    const keys = readKeys();
    for (const p of state.providers || []) {
      if (!includeOllama && p.key === 'ollama') continue;
      const label = p.label + ' — ' +
        (keys[p.key] ? 'your key (' + maskKey(keys[p.key]) + ')' : (p.available ? p.model : 'server has no key'));
      opts.push({ key: p.key, label });
    }
    return opts;
  }

  function renderSettings() {
    const strip = $('#twSettingsStrip');
    strip.innerHTML = '';
    const wrap = el('div', 'tw-form');
    wrap.style.cssText = 'padding:10px 14px;gap:8px;border-bottom:1px solid #e5e7eb';

    const cfg = state.aiConfig || defaultAiCfg();

    /* AI configuration (persisted per learner) */
    wrap.appendChild(el('div', 'tw-hint', '⚙ AI configuration (saved to your learner profile)'));
    const provRow = el('div', 'tw-field');
    provRow.appendChild(el('label', '', 'AI provider'));
    const sel = el('select');
    sel.id = 'twProv';
    sel.appendChild(new Option('Auto (best available)', ''));
    for (const o of providerOptions(true)) sel.appendChild(new Option(o.label, o.key));
    sel.value = cfg.provider;
    provRow.appendChild(sel);
    wrap.appendChild(provRow);

    const modelRow = el('div', 'tw-field');
    modelRow.appendChild(el('label', '', 'Model (optional, overrides provider default)'));
    const model = el('input');
    model.id = 'twModel';
    model.type = 'text';
    model.placeholder = 'auto';
    model.value = cfg.model || '';
    modelRow.appendChild(model);
    wrap.appendChild(modelRow);

    const tempRow = el('div', 'tw-field');
    tempRow.appendChild(el('label', '', 'Creativity (temperature)'));
    const tempLbl = el('span', 'tw-hint', ' ' + cfg.temperature.toFixed(2));
    const temp = el('input');
    temp.id = 'twTemp';
    temp.type = 'range';
    temp.min = '0'; temp.max = '1'; temp.step = '0.05'; temp.value = String(cfg.temperature);
    temp.addEventListener('input', () => { tempLbl.textContent = ' ' + Number(temp.value).toFixed(2); });
    const mcRow = el('div', '');
    mcRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    tempRow.appendChild(mcRow);
    mcRow.appendChild(document.createElement('span')).appendChild(temp);
    mcRow.appendChild(tempLbl);
    wrap.appendChild(tempRow);

    const btnRow = el('div', 'tw-btn-group');
    const save = el('button', 'tw-btn tw-btn-sm tw-btn-primary', 'Save config');
    const reset = el('button', 'tw-btn tw-btn-sm', 'Reset to defaults');
    btnRow.appendChild(save); btnRow.appendChild(reset);
    wrap.appendChild(btnRow);
    sel.addEventListener('change', () => { state.aiConfig.provider = sel.value; });
    save.addEventListener('click', () => saveAiCfg(sel.value, model.value, temp.value));
    reset.addEventListener('click', () => resetAiCfg());
    strip.appendChild(wrap);

    /* Bring-your-own-key (browser only, never stored server-side) */
    const byok = el('div', 'tw-form');
    byok.style.cssText = 'padding:10px 14px;gap:8px;border-bottom:1px solid #e5e7eb';
    byok.appendChild(el('div', 'tw-hint', '🔑 Bring your own API key (kept in this browser only)'));
    const bRow = el('div', 'tw-field');
    bRow.appendChild(el('label', '', 'Provider'));
    const ksel = el('select');
    ksel.id = 'twByokProv';
    const provCfg = state.aiConfig || defaultAiCfg();
    const kprovSel = provCfg.provider && BYOK_PROVIDERS.includes(provCfg.provider) ? provCfg.provider : 'openrouter';
    for (const k of BYOK_PROVIDERS) ksel.appendChild(new Option(k, k));
    ksel.value = kprovSel;
    bRow.appendChild(ksel);
    const kInput = el('input');
    kInput.id = 'twByokKey';
    kInput.type = 'password';
    kInput.placeholder = 'sk-… (never leaves your browser to storage)';
    const existingKey = readKeys()[kprovSel] || '';
    if (existingKey) kInput.placeholder = existingKey;
    bRow.appendChild(kInput);
    byok.appendChild(bRow);
    const kBtnRow = el('div', 'tw-btn-group');
    const kSave = el('button', 'tw-btn tw-btn-sm', 'Save key');
    const kTest = el('button', 'tw-btn tw-btn-sm', 'Test connection');
    kTest.id = 'twByokTest';
    const kClear = el('button', 'tw-btn tw-btn-sm', 'Remove');
    kBtnRow.appendChild(kSave); kBtnRow.appendChild(kTest); kBtnRow.appendChild(kClear);
    byok.appendChild(kBtnRow);
    const kHint = el('div', 'tw-hint', 'Keys are sent only to that provider (over HTTPS) for each request and to this site, never saved on the server.');
    kHint.id = 'twByokHint';
    byok.appendChild(kHint);
    strip.appendChild(byok);

    kSave.addEventListener('click', () => {
      const provider = ksel.value, k = kInput.value.trim();
      if (!k) { setStatus(false, 'enter a key to save'); return; }
      const map = readKeys(); map[provider] = k; writeKeys(map);
      kHint.textContent = provider + ' key saved in your browser (' + maskKey(k) + ').';
      setStatus(true, provider + ' key saved locally');
    });
    kClear.addEventListener('click', () => {
      const map = readKeys(); delete map[ksel.value]; writeKeys(map);
      kInput.value = ''; kInput.placeholder = 'sk-…'; kHint.textContent = ksel.value + ' key removed.';
      setStatus(true, 'key removed');
    });
    kTest.addEventListener('click', () => {
      const provider = ksel.value;
      const k = kInput.value.trim() || readKeys()[provider] || '';
      if (!k) { setStatus(false, 'save a key first'); return; }
      testKey(provider, k);
    });

    /* language + erasure */
    const langRow = el('div', 'tw-field');
    langRow.appendChild(el('label', '', 'Language'));
    const lsel = el('select');
    lsel.id = 'twLang';
    lsel.appendChild(new Option('English', 'en'));
    lsel.appendChild(new Option('हिंदी / Hinglish', 'hi'));
    lsel.value = lang();
    lsel.addEventListener('change', () => { stSet(LS.lang, lsel.value); });
    langRow.appendChild(lsel);
    strip.appendChild(langRow);

    const erase = el('button', 'tw-btn tw-btn-sm', '🗑 Erase all my data (right to erasure)');
    erase.addEventListener('click', eraseData);
    strip.appendChild(erase);
  }

  async function saveAiCfg(provider, model, temperature) {
    try {
      const data = await fetchJson('/config', {
        method: 'PUT',
        body: JSON.stringify({ learnerId: learnerId(), config: { provider, model: model.trim(), temperature: Number(temperature), maxTokens: 900 } }),
      });
      if (data.saved) {
        state.aiConfig = { ...(state.aiConfig || defaultAiCfg()), ...data.config };
        writeAiCfg(state.aiConfig);
        setStatus(true, 'AI config saved to your profile');
      }
    } catch (err) { setStatus(false, 'config save failed'); }
  }

  async function resetAiCfg() {
    try {
      await fetchJson('/config', { method: 'DELETE', body: JSON.stringify({ learnerId: learnerId() }) });
      state.aiConfig = defaultAiCfg();
      writeAiCfg(state.aiConfig);
      setStatus(true, 'AI config reset to server defaults');
      renderSettings();
    } catch (err) { setStatus(false, 'reset failed'); }
  }

  async function testKey(provider, key) {
    kTestBtnBusy(true);
    try {
      const data = await fetchJson('/config', {
        method: 'POST',
        body: JSON.stringify({ action: 'test', provider, apiKey: key, learnerId: learnerId() }),
      });
      if (data.tested) setStatus(true, provider + ' OK (' + data.latencyMs + ' ms)');
      else setStatus(false, provider + ' rejected: ' + (data.error || 'unknown'));
    } catch (err) {
      setStatus(false, 'test failed: ' + (err.message || 'network'));
    } finally {
      kTestBtnBusy(false);
    }
  }

  function kTestBtnBusy(on) {
    const btn = $('#twByokTest');
    if (btn) { btn.disabled = on; btn.textContent = on ? '…' : 'Test connection'; }
  }

  async function eraseData() {
    if (!confirm('Erase all your Teddy learning data? This is permanent.')) return;
    try {
      await fetchJson('/learner', { method: 'DELETE', body: JSON.stringify({ learnerId: learnerId() }) });
      localStorage.removeItem(LS.learner);
      setStatus(true, 'your data was erased. Goodbye-safe. 🧸');
    } catch (err) {
      setStatus(false, 'erase failed — try again later');
    }
  }

  /* ---------------- tabs / panel ---------------- */
  function switchTab(name) {
    ['chat', 'quiz', 'notes'].forEach((t) => {
      const btn = { chat: tabChat, quiz: tabQuiz, notes: tabNotes }[t];
      btn.classList.toggle('tw-active', t === name);
      const pane = $('#tw' + t[0].toUpperCase() + t.slice(1) + 'Pane');
      if (pane) pane.classList.toggle('tw-active', t === name);
    });
    if (name === 'quiz') renderQuizConfig();
    if (name === 'notes') { if (!notesStage.firstChild) renderNotesForm(); }
  }

  function togglePanel() {
    state.open = !state.open;
    panel.classList.toggle('tw-closed', !state.open);
    fab.innerHTML = state.open ? '✕' : '🧸';
    fab.title = state.open ? 'Close Teddy' : 'Ask Teddy';
    fab.setAttribute('aria-expanded', String(state.open));
    if (!state.open) { stSet(LS.dismiss, '1'); return; }
    if (!state.chat.msgs.length) { switchTab('chat'); greet(); state.chat.msgs.push('greeted'); }
  }

  /* ---------------- build & init ---------------- */
  function hideCelebot() {
    document.querySelectorAll('.celebot-fab, .celebot-widget, .cyc').forEach((n) => n.remove());
  }

  function build() {
    const css = el('link');
    css.rel = 'stylesheet';
    css.href = 'teddy/teddy-widget.css';
    document.head.appendChild(css);

    fab = el('button', '', '🧸');
    fab.id = 'twFab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open Teddy, your AI study companion');
    fab.setAttribute('aria-expanded', 'false');
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    panel = el('div');
    panel.id = 'twPanel';
    panel.className = 'tw-closed';
    if (window.innerWidth <= 560) panel.classList.add('tw-mobile');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Teddy study companion');
    panel.innerHTML = `
      <div id="twHeader">
        <span class="tw-avatar">🧸</span>
        <div class="tw-titles">
          <div class="tw-name">Teddy — AI Study Companion</div>
          <div class="tw-sub">Grounded in TechLearn · M.Tech CSE · JNTUK</div>
        </div>
        <button id="twGear" title="Settings" aria-label="Settings">⚙</button>
        <button id="twClose" title="Dismiss" aria-label="Close">✕</button>
      </div>
      <div class="tw-settings" id="twSettingsStrip"></div>
      <div id="twTabs">
        <button id="twTabChat" class="tw-active">💬 Chat</button>
        <button id="twTabQuiz">⏱ Quiz</button>
        <button id="twTabNotes">📝 Notes</button>
      </div>
      <div id="twBody">
        <div class="tw-pane tw-active" id="twChatPane">
          <div id="twChatMsgs"></div>
          <div class="tw-chat-input"><textarea id="twChatInput" rows="1" placeholder="Ask about any M.Tech CSE topic…" aria-label="Message Teddy"></textarea>
            <button id="twChatSend" title="Send" aria-label="Send">➤</button></div>
        </div>
        <div class="tw-pane" id="twQuizPane"><div id="twQuizStage"></div></div>
        <div class="tw-pane" id="twNotesPane"><div id="twNotesStage"></div></div>
      </div>
      <div id="twStatus" class="tw-off"><span class="tw-dot"></span><span>Connecting…</span></div>`;
    document.body.appendChild(panel);

    tabChat = $('#twTabChat'); tabQuiz = $('#twTabQuiz'); tabNotes = $('#twTabNotes');
    chatMsgs = $('#twChatMsgs'); chatInput = $('#twChatInput'); chatSend = $('#twChatSend'); statusBar = $('#twStatus');
    quizStage = $('#twQuizStage'); notesStage = $('#twNotesStage');

    tabChat.addEventListener('click', () => switchTab('chat'));
    tabQuiz.addEventListener('click', () => switchTab('quiz'));
    tabNotes.addEventListener('click', () => switchTab('notes'));
    $('#twClose').addEventListener('click', () => { panel.classList.add('tw-closed'); state.open = false; fab.innerHTML = '🧸'; stSet(LS.dismiss, '1'); });
    const gear = $('#twGear');
    let settingsOpen = false;
    gear.addEventListener('click', () => {
      settingsOpen = !settingsOpen;
      $('#twSettingsStrip').style.cssText = settingsOpen ? '' : 'display:none';
      if (settingsOpen) renderSettings();
    });

    chatSend.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(100, chatInput.scrollHeight) + 'px'; });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open && !isAi()) togglePanel(); });
  }

  function wireStyles() {
    const st = document.createElement('style');
    st.id = 'tw-inline-fallback';
    st.textContent = `.tw-code{display:block;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:8px;overflow:auto;font-size:12px;font-family:ui-monospace,Menlo,monospace}
      .tw-h{font-weight:700;margin-top:6px;color:#b45309}.tw-quote{border-left:3px solid #fbbf24;padding-left:8px;color:#6b7280}.tw-li{margin:2px 0}
      .tw-msg-tw a, .tw-src a {color:#2563eb}`;
    document.head.appendChild(st);
    // ensure the external stylesheet loaded; if not (offline), our small fallback still keeps things sane
    const link = $('link[href="teddy/teddy-widget.css"]');
    if (link) link.addEventListener('error', () => {});
  }

  let booted = false;
  async function init() {
    if (booted || document.getElementById('twFab')) return;
    booted = true;
    hideCelebot();
    detectContext();
    build();
    wireStyles();

    if (OFF) {
      setStatus(false, 'offline view — AI features need the hosted app (Vercel)');
      const b = el('div', 'tw-offline-banner', '🧸 Offline mode. All TechLearn pages work here; AI chat, quizzes and notes require the deployed site.');
      panel.querySelector('#twChatPane').prepend(b);
      return;
    }

    try {
      const health = await fetchJson('/health', {}, 15000);
      state.providers = health.providers || [];
      for (const s of health.subjects || []) SUBJECTS[s.id] = s;
      const onlinePs = (health.providers || []).filter((p) => p.available);
      setStatus(true, 'connected · ' + (onlinePs.length ? onlinePs.length + ' AI provider' + (onlinePs.length > 1 ? 's' : '') + ' ready' : 'offline-answer mode'));
      // per-user AI configuration
      state.aiConfig = readAiCfg();
      try {
        const cfgRes = await fetchJson('/config?learnerId=' + encodeURIComponent(learnerId()), {}, 15000);
        if (cfgRes && cfgRes.config) {
          state.aiConfig = { ...defaultAiCfg(), ...readAiCfg(), ...cfgRes.config };
          writeAiCfg(state.aiConfig);
          state.providers = cfgRes.providers || state.providers;
          if (cfgRes.config && cfgRes.config.provider) setStatus(true, 'using your AI config · ' + cfgRes.config.provider);
        }
      } catch { /* server config optional — local settings still work */ }
    } catch (err) {
      setStatus(false, 'API unreachable — AI features disabled');
    }
  }

  /* Public API so the TechLearn loader can boot us if DOMContentLoaded already fired. */
  const api = { init: init };
  if (typeof window !== 'undefined') window.TeddyWidget = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();