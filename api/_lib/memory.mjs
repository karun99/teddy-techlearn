/**
 * Teddy persistent learner-memory layer (FR-9xx).
 *
 * Two backends behind one interface:
 *  1. Neo4j (Aura) — full graph persistence with the schema in db/schema.cypher.
 *  2. JSON file store — zero-config fallback for local dev / pilots.
 *     Backed by TEDDY_MEMORY_DIR (default: ./.teddy-memory). On serverless with
 *     no Neo4j configured, persistence is best-effort within a warm instance.
 */
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NEO4J_OK = process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD;

let _driver = null;

async function getDriver() {
  if (_driver) return _driver;
  try {
    const neo4j = (await import('neo4j-driver')).default;
    _driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
      { connectionTimeout: 8000 }
    );
    return _driver;
  } catch (err) {
    console.error('[memory] neo4j-driver unavailable:', err.message);
    return null;
  }
}

function fileStore() {
  const dir = process.env.TEDDY_MEMORY_DIR || join(process.cwd(), '.teddy-memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = (id) => join(dir, `${id}.json`);

  const read = (id, fallback) => {
    try {
      return existsSync(path(id)) ? JSON.parse(readFileSync(path(id), 'utf8')) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (id, data) => {
    try {
      writeFileSync(path(id), JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      console.error('[memory] write failed:', err.message);
      return false;
    }
  };

  return {
    kind: 'file',
    async ensureLearner(id) {
      const l = read(id, null);
      if (l) return l;
      const learner = { id, name: null, level: 1, createdAt: new Date().toISOString(), data: {} };
      write(id, learner);
      return learner;
    },
    async get(id) {
      return read(id, null);
    },
    async update(id, mutate) {
      const l = read(id, null) || { id, createdAt: new Date().toISOString(), data: {} };
      mutate(l);
      return write(id, l) ? l : null;
    },
    async recordStudy(id, topicId) {
      return this.update(id, (l) => {
        l.data.recentTopics = [topicId, ...(l.data.recentTopics || []).filter((t) => t !== topicId)].slice(0, 10);
        l.data.lastStudy = new Date().toISOString();
        l.data.sessions = (l.data.sessions || 0) + 1;
      });
    },
    async recordQuiz(id, outcome) {
      return this.update(id, (l) => {
        l.data.quizzes = l.data.quizzes || [];
        l.data.quizzes.push({ at: new Date().toISOString(), ...outcome });
        l.data.quizAccuracy = avg(l.data.quizzes.map((q) => q.total ? q.score / q.total : 0));
        if (outcome.score / (outcome.total || 1) >= 0.7) {
          l.data.strengths = [outcome.topicId, ...(l.data.strengths || []).filter((t) => t !== outcome.topicId)].slice(0, 10);
          l.data.struggles = (l.data.struggles || []).filter((t) => t !== outcome.topicId);
        } else if (outcome.total) {
          l.data.struggles = [outcome.topicId, ...(l.data.struggles || []).filter((t) => t !== outcome.topicId)].slice(0, 10);
        }
      });
    },
    async recordNote(id, note) {
      return this.update(id, (l) => {
        l.data.notes = l.data.notes || [];
        l.data.notes.push({ id: note.id, topicId: note.topicId, title: note.title, format: note.format, createdAt: new Date().toISOString() });
      });
    },
    async setCognitiveLoad(id, load) {
      return this.update(id, (l) => {
        l.data.cognitiveLoad = l.data.cognitiveLoad || [];
        l.data.cognitiveLoad.push({ at: new Date().toISOString(), ...load });
      });
    },
    async deleteLearner(id) {
      try {
        // eslint-disable-next-line no-unused-expressions
        existsSync(path(id)) && require_delete(path(id));
        return true;
      } catch {
        return false;
      }
    },
    async close() {},
  };
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function require_delete(p) {
  return import('node:fs').then((fs) => fs.rmSync(p, { force: true }));
}

async function neo4jStore() {
  const driver = await getDriver();
  if (!driver) return null;
  const session = () => driver.session({ database: process.env.NEO4J_DB || 'neo4j' });

  async function runOne(query, params = {}) {
    const s = session();
    try {
      const res = await s.run(query, params);
      return res.records;
    } finally {
      await s.close();
    }
  }

  return {
    kind: 'neo4j',
    async ensureLearner(id) {
      await runOne(
        'MERGE (l:Learner { id: $id }) ON CREATE SET l.createdAt = datetime(), l.level = 1 RETURN l',
        { id }
      );
      return { id };
    },
    async get(id) {
      const rows = await runOne(
        `MATCH (l:Learner { id: $id })
         OPTIONAL MATCH (l)-[s:STUDIED]->(t:Topic)
         OPTIONAL MATCH (l)-[m:MASTERED]->(mt:Topic)
         OPTIONAL MATCH (l)-[st:STRUGGLES_WITH]->(wt:Topic)
         OPTIONAL MATCH (l)-[:AUTHORED]->(n:Note)
         RETURN count(s) AS studied, count(m) AS mastered,
                count(st) AS struggles, count(n) AS notes,
                count(st) AS mod,
                avg(CASE WHEN mt IS NOT NULL THEN 1 ELSE 0 END) AS mastery`,
        { id }
      );
      return null; // context built via getContext below
    },
    async recordStudy(id, topicId) {
      await runOne(
        `MERGE (t:Topic { id: $topicId })
         MERGE (l:Learner { id: $id })
         MERGE (l)-[rel:STUDIED]->(t)
         SET rel.at = datetime(), rel.count = coalesce(rel.count, 0) + 1`,
        { id, topicId }
      );
      return true;
    },
    async recordQuiz(id, outcome) {
      await runOne(
        `MERGE (l:Learner { id: $id })
         MERGE (t:Topic { id: $topicId })
         CREATE (q:Quiz { id: $quizId, score: $score, total: $total, at: datetime() })
         MERGE (l)-[:COMPLETED]->(q)
         MERGE (q)-[:ABOUT]->(t)
         WITH l, t, $score AS score, $total AS total
         WITH l, t, score, total
         CALL apoc.do.when(score * 10 >= total * 7,
           'MERGE (l)-[r:MASTERED]->(t) SET r.confidence = score * 1.0 / total',
           'MERGE (l)-[r:STRUGGLES_WITH]->(t) SET r.confidence = score * 1.0 / total',
           { l: l, t: t, score: score, total: total }) YIELD value
         RETURN value`,
        { id, topicId: outcome.topicId, quizId: outcome.quizId || `quiz-${Date.now()}`, score: outcome.score, total: outcome.total }
      );
      return true;
    },
    async recordNote(id, note) {
      await runOne(
        `MERGE (l:Learner { id: $id })
         MERGE (t:Topic { id: $topicId })
         CREATE (n:Note { id: $noteId, title: $title, format: $format, content: $content, createdAt: datetime() })
         MERGE (l)-[:AUTHORED]->(n)
         MERGE (n)-[:COVERS]->(t)`,
        { id, topicId: note.topicId, noteId: note.id, title: note.title, format: note.format, content: note.content }
      );
      return true;
    },
    async setCognitiveLoad(id, load) {
      await runOne(
        `MATCH (l:Learner { id: $id })
         CREATE (s:Session { id: $sessionId, cognitiveLoad: $value, at: datetime(), source: $source })
         CREATE (l)-[:COGNITIVE_LOAD { value: $value, timestamp: datetime() }]->(s)`,
        { id, sessionId: load.sessionId, value: load.value, source: load.source || 'simulated' }
      );
      return true;
    },
    async getContext(id) {
      const rows = await runOne(
        `MATCH (l:Learner { id: $id })
         OPTIONAL MATCH (l)-[sm:MASTERED]->(mt:Topic) RETURN
           collect(mt.id) AS strengths`,
        { id }
      );
      const strengths = rows[0]?.get('strengths') || [];
      return { strengths, struggles: [], recentTopics: [], streak: 0 };
    },
    async deleteLearner(id) {
      await runOne(`MATCH (l:Learner { id: $id }) DETACH DELETE l`, { id });
      return true;
    },
    async close() {
      await driver?.close();
    },
  };
}

let _store = null;

export async function getMemory() {
  if (_store) return _store;
  if (NEO4J_OK) {
    const n = await neo4jStore();
    if (n) {
      _store = n;
      return n;
    }
  }
  _store = fileStore();
  return _store;
}

export async function learnerContext(id) {
  const mem = await getMemory();
  try {
    await mem.ensureLearner(id);
  } catch {
    /* never block chat on memory */
  }
  if (mem.kind === 'neo4j') {
    try {
      return await mem.getContext(id);
    } catch {
      return {};
    }
  }
  const raw = await mem.get(id);
  if (!raw) return {};
  const d = raw.data || {};
  return {
    strengths: d.strengths || [],
    struggles: d.struggles || [],
    recentTopics: d.recentTopics || [],
    quizAccuracy: d.quizAccuracy,
    streak: d.streak || 0,
    notesCount: (d.notes || []).length,
    sessions: d.sessions || 0,
  };
}

export function memoryStatus() {
  return {
    backend: NEO4J_OK ? 'neo4j' : 'file-fallback',
    fileDir: NEO4J_OK ? null : process.env.TEDDY_MEMORY_DIR || './.teddy-memory',
  };
}