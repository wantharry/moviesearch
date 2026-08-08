// One-time bulk backfill: fetches poster + overview from TMDb for every movie-type title that
// has never been fetched at all (no tmdb_details row). Unlike the live app's on-demand caching
// (which only fetches titles someone actually searches for), this sweeps the whole remaining
// catalog once so semantic search / deep tagging can cover more than whatever's been clicked on.
//
// Uses a single TMDb call per title: /find/{imdbId}?external_source=imdb_id already returns
// `overview` in its movie_results, so this does NOT need the second /movie/{tmdbId} call the live
// app makes for certification/countries — those stay unpopulated for these titles (same as today,
// not a regression). Run scripts/db/backfill-countries... (not built) separately if that's ever wanted.
//
// Resumable: the query re-checks "no tmdb_details row yet" each run, so a stopped/restarted run
// just skips whatever's already been saved. Safe to Ctrl+C at any time.
//
// Usage: DB_PATH=/dev/shm/movies.db TMDB_RATE=20 node scripts/db/backfill-descriptions.js
const path = require("path");
const Database = require("better-sqlite3");

try {
  process.loadEnvFile(path.join(__dirname, "..", "..", ".env"));
} catch {
  // no .env — TMDB_API_KEY can still come from the real environment
}

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "movies.db");
const BACKUP_PATH = process.env.BACKUP_PATH || path.join(DATA_DIR, "movies-v2.db");
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const RATE_PER_SEC = parseInt(process.env.TMDB_RATE || "20", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);
const CHECKPOINT_EVERY_MS = 30 * 60 * 1000; // 30 min

if (!TMDB_API_KEY) {
  console.error("Missing TMDB_API_KEY (set in .env or the environment).");
  process.exit(1);
}
const isV4Token = TMDB_API_KEY.split(".").length === 3;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const savePoster = db.prepare(
  "INSERT INTO posters (imdbId, tmdbId, posterUrl, fetchedAt) VALUES (@imdbId, @tmdbId, @posterUrl, @fetchedAt) " +
  "ON CONFLICT(imdbId) DO UPDATE SET tmdbId=excluded.tmdbId, posterUrl=excluded.posterUrl, fetchedAt=excluded.fetchedAt"
);
const saveDetails = db.prepare(
  "INSERT INTO tmdb_details (imdbId, certification, countries, overview, fetchedAt) VALUES (@imdbId, @certification, @countries, @overview, @fetchedAt) " +
  "ON CONFLICT(imdbId) DO UPDATE SET overview=excluded.overview, fetchedAt=excluded.fetchedAt"
);

// 86.8% of movie-type titles with no tmdb_details row have votes IS NULL — unproduced/unreleased
// stub entries in IMDb's own dataset (confirmed via direct TMDb calls: 0/3000 sampled had any
// match at all). votes 1-9 fared almost as badly in testing (obscure old/regional titles TMDb
// mostly never indexed) — votes>=10 is where real hit rate starts, and still covers 84% of the
// remaining pool. Ordering by votes DESC front-loads the titles most likely to matter *and* most
// likely to actually be found, so an interrupted run still captured the highest-value ones first.
const MIN_VOTES = parseInt(process.env.MIN_VOTES || "10", 10);

function getQueue() {
  return db
    .prepare(
      `SELECT t.imdbId AS imdbId FROM titles t
       WHERE t.isAdult = 0 AND t.titleType = 'movie' AND t.votes >= ?
       AND NOT EXISTS (SELECT 1 FROM tmdb_details td WHERE td.imdbId = t.imdbId)
       ORDER BY t.votes DESC`
    )
    .all(MIN_VOTES)
    .map((r) => r.imdbId)
    .reverse(); // workers consume via queue.pop() (O(1) from the end), so reverse to pop highest-votes first
}

// Shared token-bucket rate limiter across all concurrent workers, same style as server.js's
// tmdbFetch (max N requests per rolling 1s window), just standalone since this is a separate
// process from the live server and can't share its in-memory limiter.
let requestCount = 0;
let resetTime = Date.now() + 1000;
async function throttle() {
  const now = Date.now();
  if (now >= resetTime) {
    requestCount = 0;
    resetTime = now + 1000;
  }
  if (requestCount >= RATE_PER_SEC) {
    await new Promise((r) => setTimeout(r, resetTime - now));
    return throttle();
  }
  requestCount++;
}

async function findByImdbId(imdbId, retries = 3) {
  await throttle();
  const url = isV4Token
    ? `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`
    : `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetch(url, {
      headers: isV4Token ? { Authorization: `Bearer ${TMDB_API_KEY}` } : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return findByImdbId(imdbId, retries - 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.movie_results?.[0] || null;
  } catch (err) {
    if (retries > 0) return findByImdbId(imdbId, retries - 1);
    console.error(`Failed ${imdbId}: ${err.message}`);
    return null;
  }
}

let processed = 0;
let found = 0;
let notFound = 0;
const startTime = Date.now();

async function worker(queue) {
  while (queue.length) {
    const imdbId = queue.pop();
    const match = await findByImdbId(imdbId);
    const now = Date.now();
    if (match) {
      found++;
      savePoster.run({
        imdbId,
        tmdbId: match.id ?? null,
        posterUrl: match.poster_path ? `https://image.tmdb.org/t/p/w342${match.poster_path}` : null,
        fetchedAt: now,
      });
      saveDetails.run({
        imdbId,
        certification: null,
        countries: "",
        overview: match.overview || null,
        fetchedAt: now,
      });
    } else {
      notFound++;
      // Still record an attempt so this title isn't re-queried forever on resume.
      saveDetails.run({ imdbId, certification: null, countries: "", overview: null, fetchedAt: now });
    }
    processed++;
    if (processed % 500 === 0) {
      const elapsed = (now - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = queue.length / rate;
      console.log(
        `${processed.toLocaleString()} done (${found.toLocaleString()} found, ${notFound.toLocaleString()} not on TMDb) ` +
        `| ${rate.toFixed(1)}/s | ~${(remaining / 60).toFixed(0)}min remaining | queue=${queue.length.toLocaleString()}`
      );
    }
  }
}

async function main() {
  const queue = getQueue();
  console.log(`${queue.length.toLocaleString()} movie titles to fetch, rate=${RATE_PER_SEC}/s, concurrency=${CONCURRENCY}`);
  console.log(`Estimated time: ~${(queue.length / RATE_PER_SEC / 3600).toFixed(1)} hours`);

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
  console.log(`\nDone. ${processed.toLocaleString()} processed (${found.toLocaleString()} found, ${notFound.toLocaleString()} not on TMDb).`);
  console.log(`Final checkpoint to ${BACKUP_PATH}...`);
  await db.backup(BACKUP_PATH);
  console.log("Backup complete.");
  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
