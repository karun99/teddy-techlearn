# Teddy × TechLearn — AI-enhanced M.Tech CSE Learning Hub

An AI-powered study companion layered over the [TechLearn](https://github.com/karun99/techlearn) static M.Tech CSE syllabus hub (JNTU Kakinada): 25 subjects, 125 units, 625 topics, 931 static HTML pages, now enhanced with a floating **Teddy** AI assistant and a serverless cognitive backend — fully deployable to Vercel.

The 931 static pages are served **unchanged**; every AI feature is injected at runtime and backed by `api/*` serverless functions.

## Features (FR coverage of the SRS)

| Pillar | What it does | SRS refs |
|---|---|---|
| **Teddy assistant** | Floating chat widget on every page; Socratic Duet-style persona; bilingual (English + Telugu); crisis/mental-health protocol; context-aware from the current topic page | FR-1xx, FR-2xx, AI-1xx, FR-11xx |
| **Grounding & RAG** | BM25 retrieval over the full syllabus (subjects/units/topics), glossary (parsed from `glossary.html`), and PYQs. LLM answers are grounded; ungrounded questions are refused (safe-fail) | FR-4xx, FR-5xx |
| **Provider router** | 6 LLM providers with a fallback chain: Gemini (default free tier) → OpenRouter → OpenAI → Anthropic → Groq → local Ollama. Zero-key offline mode returns grounded compiled answers | FR-12xx, AI-2xx |
| **User AI control** | Per-learner provider/model/temperature saved to their profile; "bring your own key" kept only in the browser and applied per-request — users can switch stack even if the site has no server keys | AI-CONFIG-1xx |
| **Timed quizzes** | MCQs + PYQs with timer, flags, hints, scoring, strong/weak-topic tracking; answer key rebuilt server-side (client never sees answers during the quiz) | FR-13xx (AI-3xx style), FR-15xx |
| **Adaptive notes** | Cornell, outline, and flashcard note templates per topic; export to Markdown, JSON, and Anki CSV | FR-16xx |
| **Persistent memory** | Learner graph in Neo4j (Aura) with file-store fallback; study history, mastery, mistakes; learner data erasure (right to be forgotten) | FR-9xx, FR-904, FR-101x, AI-4xx |
| **Cognitive load (OI)** | Grounded "Other Inputs" signal on chat vs note-taking activity to keep load manageable (simulated / pluggable) | AI-4xx/P-12xx |

## Repo layout

```
api/              Vercel serverless functions (chat, quiz, notes, rag, config, health, learner)
api/_lib/         syllabus loader, BM25 RAG, provider router, persona, memory, notes, OI, chat core
teddy/            injected widget (teddy-widget.js + CSS)
scripts/          verify.mjs (21-check test suite), serve.mjs (local dev server)
db/schema.cypher  Neo4j schema + edge cheat-sheet
prompts/          portable, model-agnostic Teddy prompt pack
data/*.cjs        syllabus source (25 subjects — the single source of truth)
*.html            the 931 static TechLearn pages (left untouched)
```

## Get it running

```bash
npm install                 # installs neo4j-driver (runtime only; no SDK needed)
node scripts/verify.mjs     # 21/21 checks: syllabus, RAG, chat, refusal, quiz, notes, health
node scripts/serve.mjs      # local static + API server → http://localhost:8787
```

## Deploy to Vercel

See **[DEPLOY.md](./DEPLOY.md)** for env vars (`GEMINI_API_KEY`, optional `NEO4J_*`, ...) and the exact deploy + verification steps. Without keys the site runs in grounded offline-answer mode.

## Credits
- TechLearn (static hub + syllabus data): https://github.com/karun99/techlearn
- Duet / Digital-Twin Technology (persona & pedagogy research): https://github.com/nsktech994/Duet--Digital-Twin-Technology
- Teddy persona: originally devised with my "Teddy" teacher-companion concept; this build is a fresh, original implementation of that persona in a bespoke stack.

## MCP server

This application ships a dependency-free [Model Context Protocol](https://modelcontextprotocol.io)
server (`mcp-server/server.mjs`) exposing its core operations to agentic clients.
It speaks JSON-RPC 2.0 over stdio and adds no runtime dependencies.

Add the repository's [`.mcp.json`](.mcp.json) to your MCP client, or run:

```bash
node mcp-server/server.mjs
```

Protocol smoke tests:

```bash
python3 -m unittest discover -s tests -p "test_mcp_server.py" -v
```

See [docs/MCP.md](docs/MCP.md) and [mcp-server/README.md](mcp-server/README.md).
