// Deep per-movie tagging via a local LLM (Ollama), as a richer complement to the existing
// embedding-similarity tag system (tag-vocabulary.js / generate-tags.js). Unlike that system's
// fixed 68-tag vocabulary, this reads each movie's actual description and asks the model to
// extract free-form tags + very specific keyword phrases — captures nuance a fixed cosine-
// similarity vocabulary can't (multi-word plot specifics, less common themes, etc).
//
// Fully additive: writes only to new tables (title_tags_llm, title_keywords_llm,
// title_llm_attempted) that nothing else reads yet. Safe to delete entirely with
// `DROP TABLE title_tags_llm; DROP TABLE title_keywords_llm; DROP TABLE title_llm_attempted;`
// with zero effect on anything else.
//
// Resumable: title_llm_attempted records every movie already processed (success or failure), so
// a stopped/restarted run just skips those and continues. Safe to Ctrl+C anytime.
//
// Usage: DB_PATH=/dev/shm/movies.db node scripts/embeddings/generate-tags-llm.js
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "movies.db");
const BACKUP_PATH = process.env.BACKUP_PATH || path.join(DATA_DIR, "movies-v2.db");
const MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "4", 10);
const CHECKPOINT_EVERY_MS = 30 * 60 * 1000; // 30 min

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`CREATE TABLE IF NOT EXISTS title_tags_llm (imdbId TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (imdbId, tag))`);
db.exec(`CREATE TABLE IF NOT EXISTS title_keywords_llm (imdbId TEXT NOT NULL, keyword TEXT NOT NULL, PRIMARY KEY (imdbId, keyword))`);
db.exec(`CREATE TABLE IF NOT EXISTS title_llm_attempted (imdbId TEXT PRIMARY KEY, attemptedAt INTEGER, ok INTEGER)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_title_tags_llm_tag ON title_tags_llm(tag)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_title_keywords_llm_keyword ON title_keywords_llm(keyword)`);

const insertTag = db.prepare("INSERT OR IGNORE INTO title_tags_llm (imdbId, tag) VALUES (?, ?)");
const insertKeyword = db.prepare("INSERT OR IGNORE INTO title_keywords_llm (imdbId, keyword) VALUES (?, ?)");
const markAttempted = db.prepare(
  "INSERT INTO title_llm_attempted (imdbId, attemptedAt, ok) VALUES (?, ?, ?) ON CONFLICT(imdbId) DO UPDATE SET attemptedAt=excluded.attemptedAt, ok=excluded.ok"
);

const saveResult = db.transaction((imdbId, tags, keywords) => {
  for (const tag of tags) insertTag.run(imdbId, tag);
  for (const kw of keywords) insertKeyword.run(imdbId, kw);
  markAttempted.run(imdbId, Date.now(), 1);
});
const saveFailure = db.transaction((imdbId) => {
  markAttempted.run(imdbId, Date.now(), 0);
});

function getQueue() {
  return db
    .prepare(
      `SELECT t.imdbId AS imdbId, t.title AS title, t.genres AS genres, td.overview AS overview
       FROM titles t
       JOIN tmdb_details td ON td.imdbId = t.imdbId
       WHERE t.isAdult = 0 AND t.titleType = 'movie'
       AND td.overview IS NOT NULL AND length(td.overview) > 40
       AND NOT EXISTS (SELECT 1 FROM title_llm_attempted a WHERE a.imdbId = t.imdbId)
       ORDER BY t.votes DESC`
    )
    .all()
    .reverse(); // consumed via queue.pop(), so reverse to process highest-votes first
}

function buildPrompt(m) {
  const genres = (m.genres || "").split(",").filter(Boolean).join(", ");
  // Deliberately no example tag phrases here — a small model will echo literal examples from
  // the instructions into unrelated movies (confirmed: "wrongful imprisonment", used as an
  // illustrative example, showed up as a tag on Prometheus, Spider-Man 3, Frozen, etc. in
  // testing — 58% of a sample batch). Describe the desired property abstractly instead.
  return `You are tagging a movie for a search engine, based only on its description below. Extract:
1. "tags": 5-10 tags describing THIS movie's plot devices, themes, tone, setting, and subgenre (lowercase, 1-3 words each). Every tag must be something actually present in the description — do not use generic genre words alone, and do not reuse tags from other movies.
2. "keywords": 4-8 short phrases specific to this exact plot, describing a specific and identifiable event, twist, or element that would let someone recognize this exact movie.

Title: ${m.title}
Genres: ${genres || "unknown"}
Description: ${m.overview}

Respond with ONLY valid JSON: {"tags": [...], "keywords": [...]}`;
}

async function callOllama(m, retries = 2) {
  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: buildPrompt(m),
        format: "json",
        stream: false,
        options: { temperature: 0.1, num_predict: 350 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean) : [];
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean) : [];
    return { tags, keywords };
  } catch (err) {
    if (retries > 0) return callOllama(m, retries - 1);
    console.error(`Failed ${m.imdbId} (${m.title}): ${err.message}`);
    return null;
  }
}

let processed = 0;
let ok = 0;
let failed = 0;
const startTime = Date.now();

async function worker(queue) {
  while (queue.length) {
    const m = queue.pop();
    const result = await callOllama(m);
    if (result && (result.tags.length || result.keywords.length)) {
      saveResult(m.imdbId, result.tags, result.keywords);
      ok++;
    } else {
      saveFailure(m.imdbId);
      failed++;
    }
    processed++;
    if (processed % 500 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = queue.length / rate;
      console.log(
        `${processed.toLocaleString()} done (${ok.toLocaleString()} ok, ${failed.toLocaleString()} failed) ` +
        `| ${rate.toFixed(2)}/s | ~${(remaining / 3600).toFixed(1)}h remaining | queue=${queue.length.toLocaleString()}`
      );
    }
  }
}

async function main() {
  const queue = getQueue();
  console.log(`${queue.length.toLocaleString()} movies to tag, model=${MODEL}, concurrency=${CONCURRENCY}`);
  console.log(`Estimated time: ~${(queue.length / 2.2 / 3600).toFixed(1)} hours at ~2.2/s`);

  let checkpointing = false;
  const checkpointTimer = setInterval(() => {
    if (checkpointing) return;
    checkpointing = true;
    console.log(`Checkpointing to ${BACKUP_PATH}...`);
    const start = Date.now();
    db.backup(BACKUP_PATH)
      .then(() => console.log(`Checkpoint done in ${((Date.now() - start) / 1000).toFixed(1)}s`))
      .catch((err) => console.error("Checkpoint failed:", err.message))
      .finally(() => (checkpointing = false));
  }, CHECKPOINT_EVERY_MS);

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

  clearInterval(checkpointTimer);
  console.log(`\nDone. ${processed.toLocaleString()} processed (${ok.toLocaleString()} ok, ${failed.toLocaleString()} failed).`);
  if (!checkpointing) {
    console.log(`Final checkpoint to ${BACKUP_PATH}...`);
    await db.backup(BACKUP_PATH);
    console.log("Backup complete.");
  }
  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
