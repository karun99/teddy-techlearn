# 🧸 Teddy × TechLearn — Deployment Guide

Deploy the AI-enhanced M.Tech CSE Learning Hub (TechLearn static site + Teddy AI layer) to Vercel.

## Prerequisites
- Node 18+ (this machine has Node 24)
- Vercel account + CLI authenticated: `vercel login`
- At least one LLM API key (optional for deploy; the app degrades to grounded offline answers without one)

## 1. Configure environment variables
Set these in the Vercel dashboard (`teddy-techlearn.vercel.app` → Settings → Environment Variables) or with the CLI:

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | any one | Gemini (default provider) |
| `OPENROUTER_API_KEY` | any one | OpenRouter BYOK |
| `OPENAI_API_KEY` | any one | OpenAI |
| `ANTHROPIC_API_KEY` | any one | Anthropic Claude |
| `GROQ_API_KEY` | any one | Groq |
| `OLLAMA_HOST` | optional | Local Ollama (e.g. `http://192.168.1.5:11434`) + `OLLAMA_ENABLED=true` |
| `PRIMARY_PROVIDER` | optional | `gemini` (default) / `openrouter` / `openai` / `anthropic` / `groq` / `ollama` |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | optional | Enables persistent learner graph (Neo4j Aura). Without them, the app uses a file fallback (best-effort on serverless). |
| `OI_ENABLED` | optional | `false` to disable simulated OI signals (default on) |
| `TEDDY_MEMORY_DIR` | optional | Override local memory dir |

Example (CLI):
```
vercel env add GEMINI_API_KEY
vercel env add NEO4J_URI
```

## 2. Deploy
```
vercel --prod
```
Vercel detects `api/*.js` as serverless functions and serves the 931 static HTML pages unchanged..

## 3. Verify
- Open `https://teddy-techlearn.vercel.app/index.html` — all static pages load.
- The 🧸 Teddy FAB appears on every page (injected, no HTML edits).
- `https://teddy-techlearn.vercel.app/api/health` shows providers, syllabus (25/125/625), memory backend, OI status.

## 4. Local development (no auth needed)
```
node scripts/verify.mjs     # run the 21-check API test suite
node scripts/serve.mjs      # static + API on http://localhost:8787
```

## 5. Neo4j (persistent memory)
1. Create an AuraDB free instance.
2. Run `db/schema.cypher` in its console.
3. Add `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` env vars and redeploy.
`/api/health` → `memory.backend` will show `neo4j`.

## Upgrade path for TechLearn content
The `_gen/generate.js` pipeline is untouched. To regenerate pages after a syllabus update, run the existing generator and redeploy; the RAG layer re-reads `data/*.cjs` at runtime.