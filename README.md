# M.Tech CSE Learning Hub — JNTU Kakinada

A self-contained, static learning web application built directly from the **JNTU
Kakinada M.Tech (CSE) syllabus** (applicable from the 2019-20 batch). It converts the
full syllabus into an interactive, stress-reducing study tool: structured unit-wise
theory pages, a built-in **JNTU repeated / most-asked questions** bank, interactive
quizzes, and progress tracking — all running offline with zero build steps.

## Features

- **Semester-based navigation** (Sem 1 → 4) with a subject hub per semester.
- **Unit-wise theory pages** per subject with objective, outcomes, references,
  Mermaid diagrams and key-point boxes.
- **JNTU repeated questions bank** (per unit + overall) — focus on what actually came
  in exams.
- **Interactive activities** — MCQ quizzes per unit, scored and persisted.
- **Progress tracking + chain-lock** — a unit unlocks only after the previous unit is
  completed, giving a clear, low-anxiety path through the course.
- **Mobile-first, responsive** design.

## Tech Stack

- Pure **HTML5 + CSS3 + vanilla JS (ES6+)** — no frameworks, no build tools.
- CDN dependencies only: **Font Awesome** (icons) and **Mermaid.js** (diagrams).
- **Progress + scores** persisted via `localStorage`.
- Runs offline: just open any HTML file in a browser (start at `index.html`).

## Content

- **25 subjects** across 4 semesters
- **125 units**
- **625 topics**
- **931 generated HTML pages**

| Semester | Subjects |
|----------|----------|
| 1 | MFC, Advanced DS & Algorithms, Big Data Analytics, DIP, Advanced OS, ACN, IoT, OOSE, Research Methodology & IPR, Labs |
| 2 | Machine Learning, MEAN Stack, Advanced Databases & Mining, Ad Hoc & Sensor Networks, Soft Computing, Cloud Computing, Principles of Computer Security, High Performance Computing, Labs, Mini Project |
| 3 | Deep Learning, Social Network Analysis, Open Electives, Dissertation-I |
| 4 | Dissertation-II |

## Project Structure

```
M.Tech/
├── index.html           Home / dashboard
├── semester1..4.html    Semester hubs
├── subject-*.html       Subject overview + unit hub
├── subject-*-act-u*.html  Per-unit activity (quiz) pages
├── subject-*-pyq-u*.html  Per-unit JNTU repeated questions
├── topic-*-u*-t*.html   Unit topic theory pages
├── glossary.html        Searchable key-term glossary
├── data/*.cjs           Subject syllabus data (25 modules)
├── _gen/generate.js     Static page generator
├── styles.css           Design system
├── script.js            Core JS modules
└── task.md              Build plan / acceptance criteria
```

## Build

Pages are pre-generated, so **no build step is required** to use the site. To
regenerate the static pages from the syllabus data:

```
node _gen/generate.js
```

## Deploy

The site is fully static and deploys on any static host (GitHub Pages, Vercel,
Netlify). Push the folder to GitHub and connect it to Vercel as a static project.

## Getting Started

Open `index.html` in any modern browser. Complete a unit's activity (score 40%+)
to mark it complete and unlock the next unit.
