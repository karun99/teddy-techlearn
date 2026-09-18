// Teddy × TechLearn — Neo4j Aura schema (FR-9xx)
// Run against your Aura instance once. Node types mirror TechLearn IDs.
// Subject codes == data/*.cjs ids (dsa, ml, dl, ...).
// Topic ids == TechLearn topic filenames e.g. 'topic-dsa-u3-t2' (or 'dsa-u3-t2').

// --- Constraints & indexes ---
CREATE CONSTRAINT learner_id IF NOT EXISTS FOR (l:Learner) REQUIRE l.id IS UNIQUE;
CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT subject_id IF NOT EXISTS FOR (s:Subject) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT unit_key IF NOT EXISTS FOR (u:Unit) REQUIRE (u.subjectId, u.number) IS UNIQUE;
CREATE INDEX note_id_idx IF NOT EXISTS FOR (n:Note) ON (n.id);
CREATE INDEX interaction_time_idx IF NOT EXISTS FOR (i:Interaction) ON (i.timestamp);

// --- Persistent note: seed a subject/topic skeleton (run per subject) ---
// MATCH paths from syllabus data are inserted by the ingestor
// (Teddy stores them on demand via MERGE). Example skeleton for DSA:
// MERGE (s:Subject { id: 'dsa', title: 'Advanced Data Structures & Algorithms', code: 'MTCSE1102', semester: 1 })
// MERGE (u:Unit { subjectId: 'dsa', number: 1, title: 'Introduction to Data Structures' })
// MERGE (u)-[:HAS_UNIT]->(s)  -- see edge directions below
// MERGE (t:Topic { id: 'topic-dsa-u1-t1', title: 'Introduction to Data Structures', unitNumber: 1, subjectCode: 'dsa' })
// MERGE (u)-[:CONTAINS]->(t)

// --- Edge cheat-sheet (mirrors §6.2 of the SRS) ---
// (:Learner)-[:STUDIED { at, count }]->(:Topic)
// (:Learner)-[:MASTERED { confidence }]->(:Topic)
// (:Learner)-[:STRUGGLES_WITH { confidence }]->(:Topic)
// (:Learner)-[:ATTEMPTED { correct, at }]->(:Question)
// (:Learner)-[:COMPLETED]->(:Quiz)
// (:Learner)-[:AUTHORED]->(:Note)
// (:Session)-[:INCLUDED]->(:Interaction)
// (:Interaction)-[:ABOUT]->(:Topic)
// (:Note)-[:SUMMARIZES]->(:Session)
// (:Note)-[:COVERS]->(:Topic)
// (:Topic)-[:PREREQUISITE_OF]->(:Topic)
// (:Unit)-[:CONTAINS]->(:Topic)
// (:Subject)-[:HAS_UNIT]->(:Unit)
// (:Learner)-[:COGNITIVE_LOAD { value, timestamp }]->(:Session)

// --- Grep-style lookups used by the app ---
// Weak topics per learner:
// MATCH (l:Learner { id: $id })-[:STRUGGLES_WITH]->(t:Topic) RETURN t RETURN t.title ORDER BY t.title
// Study streak (approximate, require temporal edges):
// MATCH (l:Learner { id: $id })-[s:STUDIED]->(t:Topic) RETURN date(datetime(s.at)) AS day, count(*) ORDER BY day