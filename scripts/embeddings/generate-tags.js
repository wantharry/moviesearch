// Assigns "vibe" tags (see tag-vocabulary.js) to every movie that already has an embedding, by
// comparing that movie's existing embedding against each tag's phrase embedding — no new model
// calls per movie, this is pure math over vectors we already computed for semantic search.
//
// Usage: DB_PATH=/dev/shm/movies.db node scripts/embeddings/generate-tags.js
const path = require("path");
const Database = require("better-sqlite3");
const { TAG_VOCABULARY } = require("../../tag-vocabulary.js");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "movies.db");
const SCORE_THRESHOLD = 0.28;
const MAX_TAGS_PER_MOVIE = 8;

function cosineSim(a, b, normA) {
  let dot = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normB += b[i] * b[i];
  }
  return dot / (normA * Math.sqrt(normB) || 1);
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  console.log("Loading movie embeddings...");
  const rows = db.prepare(`SELECT imdbId, embedding FROM movie_embeddings_local`).all();
  console.log(`  ${rows.length.toLocaleString()} movies`);

  const dim = rows[0].embedding.byteLength / 4;
  const vectors = new Float32Array(rows.length * dim);
  const norms = new Float32Array(rows.length);
  const imdbIds = new Array(rows.length);
  rows.forEach((row, i) => {
    const bytes = row.embedding;
    const vec = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    vectors.set(vec, i * dim);
    let sumSq = 0;
    for (let j = 0; j < dim; j++) sumSq += vec[j] * vec[j];
    norms[i] = Math.sqrt(sumSq);
    imdbIds[i] = row.imdbId;
  });

  console.log("Loading embedding model and embedding tag phrases...");
  const { pipeline } = await import("@huggingface/transformers");
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });

  const tagVectors = [];
  for (const { label, phrase } of TAG_VOCABULARY) {
    const out = await embed(phrase, { pooling: "mean", normalize: false });
    const v = Float32Array.from(out.data);
    let sumSq = 0;
    for (let j = 0; j < dim; j++) sumSq += v[j] * v[j];
    tagVectors.push({ label, vec: v, norm: Math.sqrt(sumSq) });
  }
  console.log(`  ${tagVectors.length} tags ready`);

  db.exec(`DROP TABLE IF EXISTS title_tags`);
  db.exec(`CREATE TABLE title_tags (imdbId TEXT, tag TEXT, score REAL)`);
  const insert = db.prepare(`INSERT INTO title_tags (imdbId, tag, score) VALUES (?, ?, ?)`);
  const insertMany = db.transaction((batch) => {
    for (const row of batch) insert.run(row.imdbId, row.tag, row.score);
  });

  console.log("Scoring every movie against every tag...");
  const startTime = Date.now();
  let batch = [];
  let taggedMovies = 0;
  let totalAssignments = 0;

  for (let i = 0; i < imdbIds.length; i++) {
    const offset = i * dim;
    const movieVec = vectors.subarray(offset, offset + dim);
    const movieNorm = norms[i] || 1;

    const scored = [];
    for (const t of tagVectors) {
      const score = cosineSim(movieVec, t.vec, movieNorm);
      if (score >= SCORE_THRESHOLD) scored.push({ label: t.label, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, MAX_TAGS_PER_MOVIE);

    if (kept.length) {
      taggedMovies++;
      totalAssignments += kept.length;
      for (const k of kept) batch.push({ imdbId: imdbIds[i], tag: k.label, score: k.score });
    }

    if (batch.length >= 5000) {
      insertMany(batch);
      batch = [];
    }

    if ((i + 1) % 50000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      console.log(`  ${(i + 1).toLocaleString()}/${imdbIds.length.toLocaleString()} — ${rate.toFixed(0)}/sec`);
    }
  }
  if (batch.length) insertMany(batch);

  db.exec(`CREATE INDEX idx_title_tags_tag_imdbId ON title_tags(tag, imdbId)`);
  db.exec(`CREATE INDEX idx_title_tags_imdbId ON title_tags(imdbId)`);

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone in ${elapsed.toFixed(1)}s`);
  console.log(`  ${taggedMovies.toLocaleString()} movies got at least one tag`);
  console.log(`  ${totalAssignments.toLocaleString()} total tag assignments (avg ${(totalAssignments / taggedMovies).toFixed(1)}/movie)`);

  console.log("\nTag frequency:");
  const freq = db.prepare(`SELECT tag, COUNT(*) c FROM title_tags GROUP BY tag ORDER BY c DESC`).all();
  for (const f of freq) console.log(`  ${f.tag}: ${f.c.toLocaleString()}`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
