# M.Tech CSE Learning Application — Task / Build Plan

## Overview

A self-contained, static educational web application built from the **JNTU Kakinada
M.Tech (CSE) syllabus** (`cse syllabus.pdf`, 57 pages, applicable from 2019-20 batch).

The app converts the entire syllabus into an interactive, stress-reducing study tool.
Each subject gets structured theory pages (unit-wise), a built-in **JNTU repeated /
most-asked examination questions** bank (per unit + overall), interactive activities
(quizzes), and progress tracking. Learners can study unit-by-unit, test themselves on
frequently asked questions, and track mastery across the full programme.

## Tech Stack

- Pure **HTML5 + CSS3 + vanilla JS (ES6+)** — no frameworks, no build tools.
- CDN dependencies only: Font Awesome (icons), Mermaid.js (diagrams).
- Runs offline by opening any HTML file directly, or on any static host.
- Progress + scores persisted via `localStorage`.

## Architecture

```
M.Tech/
├── index.html            Project source: cse syllabus.pdf handled by opencode-parser
├── task.md               This file
├── opencode.jsonc        Registers opencode-parser plugin (PDF parsing)
├── package.json          Plugin runtime deps (pdf-parse, etc.)
├── .opencode/            opencode-parser skill (tool: parse)
│   └── plugin/  tools/
├── styles.css            Design system (tokens, components, responsive)
├── script.js             Core JS modules (see below)
├── data/                 Subject syllabus data (units, questions) as JS modules
│   ├── subjects.js
│   ├── questions/        Per-subject PYQ & question banks
├── semester1.html ... semester4.html
├── subject pages (theory per unit)
├── subject-act.html      Activities / JNTU repeated-question quizzes
├── subject-pyq.html      Repeated questions per unit + overall
└── README.md
```

## Core JS Modules (`script.js`)

| Module | Purpose |
|--------|---------|
| `ProgressManager` | `localStorage` progress, unit completion, chain-lock |
| `ChainLock` | Unit N requires unit N−1 completion |
| `QuizEngine` | MCQ / true-false / fill-blank quiz engine |
| `RepeatedQuestionBank` | JNTU most-asked questions per unit + overall |
| `Confetti` | Celebration animation on activity completion (bug-fixed) |
| `ContentProtection` | Optional right-click / print / devtools guard |
| `Nav / Theme` | Shared navigation, unit-theme colours, responsive menu |

## Workflow

1. Parse PDF with `opencode-parser` → syllabus TXT (full 57-page extraction).
2. For each subject, extract:
   - Course objectives & outcomes
   - Unit-wise topics
   - Text / reference books
   - JNTU repeated questions (built from the actual unit syllabus topics)
3. Generate HTML pages per subject/unit with Mermaid diagrams and key-point boxes.
4. Build activities with the JNTU question bank (per unit + overall).
5. Wire chain-lock + progress tracking across all pages.
6. Fix the confetti animation bug on activity pages.
7. Test, document (README), deliver.

## Subjects Covered (by semester)

- **Semester 1**: Mathematical Foundations of Computer Science; Advanced Data
  Structures & Algorithms; Big Data Analytics; Digital Image Processing; Advanced
  Operating Systems; Advanced Computer Networks; Internet of Things; Object Oriented
  Software Engineering; Research Methodology and IPR; Labs.
- **Semester 2**: Machine Learning; MEAN Stack Technologies; Advanced Databases and
  Mining; Ad Hoc & Sensor Networks; Soft Computing; Cloud Computing; Principles of
  Computer Security; High Performance Computing; Labs; Mini Project.
- **Semester 3**: Deep Learning; Social Network Analysis; Open Electives; Dissertation-I.
- **Semester 4**: Dissertation-II.

## "Reducing strain" design goals

- **Short, digestible unit sections** with clear headings (no walls of text).
- **Repeated questions** front-and-centre so learners focus on exam-relevant content.
- **Instant self-tests** per unit to reinforce without long study sessions.
- **Progress rings + chain-lock** gives a clear, low-anxiety path through the course.
- **Mobile-first responsive** so students can study on any device.
