// Local web app: search the imported IMDb dataset with filters, fetching/caching
// poster images from TMDb on demand (only for the movies actually shown on a page).
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // no .env file — that's fine, TMDB_API_KEY can still come from the real environment
}

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "movies.db");
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PORT = process.env.PORT || 3001;

const GENRES = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "Film-Noir", "Game-Show", "History", "Horror", "Music",
  "Musical", "Mystery", "News", "Reality-TV", "Romance", "Sci-Fi", "Short", "Sport",
  "Talk-Show", "Thriller", "War", "Western",
];

const TITLE_TYPES = ["movie", "tvMovie", "tvSeries", "tvMiniSeries", "tvSpecial", "short", "video", "videoGame", "tvShort"];
const TV_TITLE_TYPES = new Set(["tvSeries", "tvMiniSeries", "tvSpecial", "tvShort"]);

const COUNTRIES = [
  { code: "US", label: "USA" },
  { code: "IN", label: "India" },
  { code: "GB", label: "UK" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "CN", label: "China" },
  { code: "HK", label: "Hong Kong" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "MX", label: "Mexico" },
  { code: "BR", label: "Brazil" },
  { code: "RU", label: "Russia" },
  { code: "NG", label: "Nigeria" },
];
const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

let db;
try {
  db = new Database(DB_PATH, { readonly: false, fileMustExist: true });
} catch (err) {
  console.error(`Could not open ${DB_PATH}. Run "npm run import" first.`);
  process.exit(1);
}
// Default (rollback-journal) mode fsyncs on every write commit; on a slow or virtualized
// filesystem that can make a single INSERT block the entire process (better-sqlite3 is
// synchronous, so a blocked write stalls every in-flight request) for many seconds. WAL mode
// avoids that: readers aren't blocked by writers, and commits don't need a full fsync per write.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.exec(`CREATE TABLE IF NOT EXISTS posters (imdbId TEXT PRIMARY KEY, tmdbId INTEGER, posterUrl TEXT, fetchedAt INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS tmdb_details (imdbId TEXT PRIMARY KEY, certification TEXT, countries TEXT, overview TEXT, fetchedAt INTEGER)`);
// The live DB's posters/tmdb_details tables predate the PRIMARY KEY above (an earlier
// migration recreated them as plain columns), so the ON CONFLICT(imdbId) upserts below would
// fail without this. A unique index gives ON CONFLICT the same target a primary key would.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_posters_imdbId ON posters(imdbId)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tmdb_details_imdbId ON tmdb_details(imdbId)`);

// Without these, `WHERE isAdult=0 AND titleType=? ORDER BY votes/rating/year DESC LIMIT 50`
// has no index that satisfies both the filter and the sort, so SQLite materializes and
// sorts the *entire* filtered set (hundreds of thousands of rows) before applying LIMIT —
// this was the single biggest contributor to slow search/page loads (16s+ per page on the
// unfiltered "browse movies by votes" query, the default view). With the matching compound
// index SQLite walks rows in already-sorted order and stops at LIMIT: ~10ms instead.
db.exec(`CREATE INDEX IF NOT EXISTS idx_titles_browse_votes ON titles(isAdult, titleType, votes DESC, rating DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_titles_browse_rating ON titles(isAdult, titleType, rating DESC, votes DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_titles_browse_year ON titles(isAdult, titleType, year DESC, votes DESC)`);

// Create FTS5 virtual table for fast text search
console.log("Setting up FTS5 search index...");
try {
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='titles_fts'`).get();
  if (!tableExists) {
    console.log("Creating FTS5 table...");
    db.exec(`CREATE VIRTUAL TABLE titles_fts USING fts5(imdbId UNINDEXED, title, tokenize='porter unicode61')`);
    console.log("Populating FTS5 search index (this may take a moment)...");
    db.exec(`INSERT INTO titles_fts(imdbId, title) SELECT imdbId, title FROM titles WHERE isAdult = 0`);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM titles_fts`).get().c;
    console.log(`FTS5 index ready with ${count.toLocaleString()} titles!`);
  } else {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM titles_fts`).get().c;
    console.log(`FTS5 index already exists with ${count.toLocaleString()} titles`);
  }
} catch (e) {
  console.error("FTS5 setup error:", e.message);
  console.error("Text search will not be available");
}

// Migration: Add overview column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE tmdb_details ADD COLUMN overview TEXT`);
} catch (e) {
  // Column already exists, ignore
}

const getCachedPoster = db.prepare("SELECT tmdbId, posterUrl FROM posters WHERE imdbId = ?");
const getCachedDetails = db.prepare("SELECT certification, countries, overview FROM tmdb_details WHERE imdbId = ?");
const savePoster = db.prepare(
  "INSERT INTO posters (imdbId, tmdbId, posterUrl, fetchedAt) VALUES (@imdbId, @tmdbId, @posterUrl, @fetchedAt) " +
  "ON CONFLICT(imdbId) DO UPDATE SET tmdbId=excluded.tmdbId, posterUrl=excluded.posterUrl, fetchedAt=excluded.fetchedAt"
);
const saveDetails = db.prepare(
  "INSERT INTO tmdb_details (imdbId, certification, countries, overview, fetchedAt) VALUES (@imdbId, @certification, @countries, @overview, @fetchedAt) " +
  "ON CONFLICT(imdbId) DO UPDATE SET certification=excluded.certification, countries=excluded.countries, overview=excluded.overview, fetchedAt=excluded.fetchedAt"
);

// TMDb issues two key formats: a short v3 api_key (query param) and a long
// v4 "read access token" JWT (Bearer header). Support whichever was pasted.
const isV4Token = TMDB_API_KEY.split(".").length === 3;
let tmdbRequestCount = 0;
let tmdbResetTime = Date.now() + 1000;

async function tmdbFetch(urlPath, retries = 3) {
  // Simple rate limiting: max 40 requests per second (buffer below 50 limit)
  const now = Date.now();
  if (now >= tmdbResetTime) {
    tmdbRequestCount = 0;
    tmdbResetTime = now + 1000;
  }
  if (tmdbRequestCount >= 40) {
    const waitMs = tmdbResetTime - now;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return tmdbFetch(urlPath, retries);
  }
  tmdbRequestCount++;

  const sep = urlPath.includes("?") ? "&" : "?";
  const url = isV4Token ? `https://api.themoviedb.org/3${urlPath}` : `https://api.themoviedb.org/3${urlPath}${sep}api_key=${TMDB_API_KEY}`;

  try {
    // Without a timeout, a slow/hung TMDb response leaves that one request pending forever —
    // it wouldn't block other requests (unlike the synchronous SQLite calls elsewhere), but a
    // client would still hang indefinitely waiting on it.
    const res = await fetch(url, { headers: isV4Token ? { Authorization: `Bearer ${TMDB_API_KEY}` } : undefined, signal: AbortSignal.timeout(10000) });

    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      console.warn(`TMDb rate limit hit, retrying after ${retryAfter}s...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return tmdbFetch(urlPath, retries - 1);
    }

    return res.ok ? res.json() : {};
  } catch (error) {
    console.error(`TMDb fetch error for ${urlPath}:`, error.message);
    return {};
  }
}

async function fetchPoster(imdbId) {
  const cached = getCachedPoster.get(imdbId);
  if (cached) return cached;

  if (!TMDB_API_KEY) return { tmdbId: null, posterUrl: null };

  try {
    const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
    const match = data.movie_results?.[0] || data.tv_results?.[0] || null;
    const result = {
      tmdbId: match?.id ?? null,
      posterUrl: match?.poster_path ? `https://image.tmdb.org/t/p/w342${match.poster_path}` : null,
    };
    savePoster.run({ imdbId, ...result, fetchedAt: Date.now() });
    return result;
  } catch {
    return { tmdbId: null, posterUrl: null };
  }
}

// US certification + production countries via TMDb, combined into a single request per title
// (append_to_response avoids a second round-trip) and cached so repeat searches are instant.
async function fetchDetails(imdbId, tmdbId, titleType) {
  const cached = getCachedDetails.get(imdbId);
  if (cached) {
    return {
      certification: cached.certification,
      countries: cached.countries ? cached.countries.split(",").filter(Boolean) : [],
      overview: cached.overview || null,
    };
  }

  if (!TMDB_API_KEY || !tmdbId) return { certification: null, countries: [], overview: null };

  try {
    let certification = null;
    let countries = [];
    let overview = null;
    if (TV_TITLE_TYPES.has(titleType)) {
      const data = await tmdbFetch(`/tv/${tmdbId}?append_to_response=content_ratings`);
      certification = data.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating || null;
      countries = data.origin_country || [];
      overview = data.overview || null;
    } else {
      const data = await tmdbFetch(`/movie/${tmdbId}?append_to_response=release_dates`);
      const us = data.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
      certification = us?.release_dates?.find((d) => d.certification)?.certification || null;
      countries = (data.production_countries || []).map((c) => c.iso_3166_1);
      overview = data.overview || null;
    }
    saveDetails.run({ imdbId, certification, countries: countries.join(","), overview, fetchedAt: Date.now() });
    return { certification, countries, overview };
  } catch {
    return { certification: null, countries: [], overview: null };
  }
}

// Fetches poster (+ certification/countries, if requested) for a list of movies with limited concurrency.
async function attachExtras(movies, { withDetails = false, concurrency = 20 } = {}) {
  const queue = [...movies];
  async function worker() {
    while (queue.length) {
      const movie = queue.shift();
      const poster = await fetchPoster(movie.imdbId);
      movie.tmdbId = poster.tmdbId;
      movie.posterUrl = poster.posterUrl;
      if (withDetails) {
        const details = await fetchDetails(movie.imdbId, poster.tmdbId, movie.titleType);
        movie.certification = details.certification;
        movie.countries = details.countries;
        movie.overview = details.overview;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, movies.length) }, worker));
  return movies;
}

// Fires off poster/detail fetches for rows that came back from a cache-only query without
// them, so the *next* search for the same titles is instant. Never awaited by a request —
// failures are logged and otherwise ignored so they can't affect a live response.
function backgroundFillExtras(rows) {
  if (!rows.length) return;
  attachExtras(rows, { withDetails: true, concurrency: Math.min(rows.length, 20) }).catch((err) => {
    console.error("Background cache fill error:", err.message);
  });
}

// Parses the shared filter query params (genres/rating/votes/year/runtime/type/certification/
// country) into plain values once. Two consumers turn this into different things: keyword
// search (buildSqlConditions, below) needs SQL against all 12.6M titles; semantic search
// filters an in-memory array of just the ~100K embedded titles instead (see
// matchesFiltersInMemory) — building the SQL and the in-memory checks from the same parsed
// values keeps the two filter behaviors from drifting apart.
function parseFilterParams(query) {
  const {
    genres = "",
    genreMode = "any",
    minRating = "0",
    maxRating = "10",
    minVotes = "0",
    maxVotes = "",
    minYear = "",
    maxYear = "",
    minRuntime = "",
    maxRuntime = "",
    titleTypes = "movie",
    certFilter = "",
    countries = "",
  } = query;

  return {
    minRatingVal: parseFloat(minRating),
    maxRatingVal: parseFloat(maxRating),
    minVotesVal: parseInt(minVotes, 10) || 0,
    maxVotesVal: maxVotes ? parseInt(maxVotes, 10) : null,
    minYearVal: minYear ? parseInt(minYear, 10) : null,
    maxYearVal: maxYear ? parseInt(maxYear, 10) : null,
    minRuntimeVal: minRuntime ? parseInt(minRuntime, 10) : null,
    maxRuntimeVal: maxRuntime ? parseInt(maxRuntime, 10) : null,
    types: titleTypes.split(",").map((t) => t.trim()).filter((t) => TITLE_TYPES.includes(t)),
    genreList: genres.split(",").map((g) => g.trim()).filter((g) => GENRES.includes(g)),
    genreMode,
    certs: certFilter ? certFilter.split(",").map((c) => c.trim()).filter(Boolean) : [],
    countryList: countries.split(",").map((c) => c.trim()).filter((c) => COUNTRY_CODES.has(c)),
  };
}

function buildSqlConditions(parsed) {
  const conditions = ["t.isAdult = 0"];
  const params = [];

  if (parsed.minRatingVal > 0) {
    conditions.push("t.rating >= ?");
    params.push(parsed.minRatingVal);
  } else {
    conditions.push("(t.rating IS NULL OR t.rating >= ?)");
    params.push(parsed.minRatingVal);
  }
  conditions.push("(t.rating IS NULL OR t.rating <= ?)");
  params.push(parsed.maxRatingVal);

  if (parsed.minVotesVal > 0) {
    conditions.push("t.votes >= ?");
    params.push(parsed.minVotesVal);
  } else {
    conditions.push("(t.votes IS NULL OR t.votes >= ?)");
    params.push(parsed.minVotesVal);
  }
  if (parsed.maxVotesVal != null) {
    conditions.push("(t.votes IS NULL OR t.votes <= ?)");
    params.push(parsed.maxVotesVal);
  }
  if (parsed.minYearVal != null) {
    conditions.push("t.year >= ?");
    params.push(parsed.minYearVal);
  }
  if (parsed.maxYearVal != null) {
    conditions.push("t.year <= ?");
    params.push(parsed.maxYearVal);
  }
  if (parsed.minRuntimeVal != null) {
    conditions.push("t.runtimeMinutes >= ?");
    params.push(parsed.minRuntimeVal);
  }
  if (parsed.maxRuntimeVal != null) {
    conditions.push("t.runtimeMinutes <= ?");
    params.push(parsed.maxRuntimeVal);
  }
  if (parsed.types.length) {
    conditions.push(`t.titleType IN (${parsed.types.map(() => "?").join(",")})`);
    params.push(...parsed.types);
  }
  if (parsed.genreList.length) {
    const genreConds = parsed.genreList.map(() => "t.genres LIKE ?");
    params.push(...parsed.genreList.map((g) => `%,${g},%`));
    conditions.push(`(${genreConds.join(parsed.genreMode === "all" ? " AND " : " OR ")})`);
  }

  let needsDetailsJoin = false;
  if (parsed.certs.length) {
    needsDetailsJoin = true;
    conditions.push(`td.certification IN (${parsed.certs.map(() => "?").join(",")})`);
    params.push(...parsed.certs);
  }

  return { conditions, params, needsDetailsJoin };
}

// Mirrors buildSqlConditions' logic, but as a JS predicate over the in-memory embedding-index
// metadata (see initSemanticSearch) instead of a SQL WHERE clause — semantic search filters
// only the ~100K embedded titles, entirely in memory, rather than joining against them.
function matchesFiltersInMemory(meta, parsed) {
  if (parsed.types.length && !parsed.types.includes(meta.titleType)) return false;

  if (parsed.minRatingVal > 0 && (meta.rating == null || meta.rating < parsed.minRatingVal)) return false;
  if (meta.rating != null && meta.rating > parsed.maxRatingVal) return false;

  if (parsed.minVotesVal > 0 && (meta.votes == null || meta.votes < parsed.minVotesVal)) return false;
  if (parsed.maxVotesVal != null && meta.votes != null && meta.votes > parsed.maxVotesVal) return false;

  if (parsed.minYearVal != null && (meta.year == null || meta.year < parsed.minYearVal)) return false;
  if (parsed.maxYearVal != null && (meta.year == null || meta.year > parsed.maxYearVal)) return false;
  if (parsed.minRuntimeVal != null && (meta.runtimeMinutes == null || meta.runtimeMinutes < parsed.minRuntimeVal)) return false;
  if (parsed.maxRuntimeVal != null && (meta.runtimeMinutes == null || meta.runtimeMinutes > parsed.maxRuntimeVal)) return false;

  if (parsed.genreList.length) {
    const match =
      parsed.genreMode === "all"
        ? parsed.genreList.every((g) => meta.genresList.includes(g))
        : parsed.genreList.some((g) => meta.genresList.includes(g));
    if (!match) return false;
  }

  if (parsed.certs.length && !parsed.certs.includes(meta.certification)) return false;

  return true;
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Fetch full movie details on-demand (for the detail modal). Single-row, so a live
// TMDb fetch here is acceptable latency-wise — and now that the cache actually
// persists, repeat opens of the same title are instant.
app.get("/api/movie/:imdbId", async (req, res) => {
  const { imdbId } = req.params;
  const row = db.prepare(`SELECT * FROM titles WHERE imdbId = ?`).get(imdbId);
  if (!row) return res.status(404).json({ error: "Movie not found" });

  row.genres = row.genres.split(",").filter(Boolean);
  const poster = await fetchPoster(row.imdbId);
  row.tmdbId = poster.tmdbId;
  row.posterUrl = poster.posterUrl;

  const details = await fetchDetails(row.imdbId, poster.tmdbId, row.titleType);
  row.certification = details.certification;
  row.countries = details.countries;
  row.overview = details.overview;

  res.json(row);
});

app.get("/api/genres", (req, res) => {
  res.json({ genres: GENRES, titleTypes: TITLE_TYPES, countries: COUNTRIES });
});

app.get("/api/autocomplete", (req, res) => {
  const { q = "" } = req.query;
  const query = q.trim();

  if (!query || query.length < 2) {
    return res.json({ results: [] });
  }

  try {
    const searchQuery = query.split(/\s+/).map((term) => `${term}*`).join(" ");
    // A short prefix (e.g. "Mo*") can match a huge fraction of the 12.6M-title FTS index —
    // `ORDER BY votes DESC` over that many matches forces SQLite to materialize and sort all
    // of them (no index can satisfy an FTS MATCH + external-column ORDER BY together), which
    // measured 60s+ and blocks every other request since better-sqlite3 is synchronous. Capping
    // the raw FTS match count *before* the join+sort bounds the worst case to low hundreds of ms
    // regardless of how broad the prefix is, at the cost of not necessarily finding the single
    // most-voted title among an extremely broad match set — an acceptable trade for autocomplete.
    const results = db
      .prepare(
        `SELECT t.imdbId, t.title, t.year, t.rating, t.votes, p.posterUrl AS posterUrl
         FROM (SELECT imdbId FROM titles_fts WHERE titles_fts MATCH ? LIMIT 500) m
         JOIN titles t ON t.imdbId = m.imdbId
         LEFT JOIN posters p ON p.imdbId = t.imdbId
         ORDER BY t.votes DESC
         LIMIT 10`
      )
      .all(searchQuery);

    res.json({ results });
  } catch (error) {
    console.error("Autocomplete error:", error);
    res.json({ results: [] });
  }
});

app.get("/api/search", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

  const { q = "", sortBy = "votes", page = "1", pageSize = "50" } = req.query;

  const parsedFilters = parseFilterParams(req.query);
  const { conditions, params, needsDetailsJoin } = buildSqlConditions(parsedFilters);
  const { countryList } = parsedFilters;

  const searchQuery = q.trim();
  let fromClause = "FROM titles t";
  let ftsParams = [];
  if (searchQuery) {
    // Use OR logic for multi-word searches to find movies matching any term
    // This gives better results for queries like "woman spy" (finds movies with either word)
    const ftsQuery = searchQuery.split(/\s+/).map((term) => `${term}*`).join(" OR ");
    // A short/broad query (or even a single common word) can MATCH a huge fraction of the
    // 12.6M-title FTS index, and ORDER BY needs an unavoidable temp-sort over whatever
    // titles_fts hands back (no index covers "FTS MATCH" + an external sort column together) —
    // measured 60s+ and, since better-sqlite3 is synchronous, blocks every other request on the
    // server while it runs. Capping the raw match count bounds that, but only if the capped
    // subquery is also what *drives* the query — plain `titles t JOIN (subquery)` still let the
    // planner scan all 744K+ titles and probe the subquery per row (measured 30s+ on its own).
    // Putting the subquery first with CROSS JOIN pins the join order so it drives instead.
    // bm25() has to be computed here, inside the subquery, since it needs direct access to the
    // titles_fts cursor — it can't be called again from the outer query once joined through.
    fromClause = `FROM (SELECT imdbId, bm25(titles_fts) AS ftsRank FROM titles_fts WHERE titles_fts MATCH ? LIMIT 5000) fts_m
      CROSS JOIN titles t ON t.imdbId = fts_m.imdbId`;
    ftsParams = [ftsQuery];
  }
  // fromClause's placeholder (when present) appears before the WHERE clause in the assembled
  // SQL, so its param must be bound first.
  const withFtsParams = (rest) => (ftsParams.length ? [...ftsParams, ...rest] : rest);

  // Posters are always left-joined (cache-only, no live fetch here). Details are inner-joined
  // only when a certification filter needs them to match — otherwise left-joined so titles
  // without cached details still show up (just without cert/overview until background-filled).
  const extraJoins = `LEFT JOIN posters p ON p.imdbId = t.imdbId ${
    needsDetailsJoin ? "INNER JOIN" : "LEFT JOIN"
  } tmdb_details td ON td.imdbId = t.imdbId`;
  // COUNT(*) doesn't need poster/detail columns, only whether a row matches — so it skips the
  // posters join entirely (an unfiltering LEFT JOIN just adds ~1 extra index lookup per row for
  // no benefit) and only joins tmdb_details when the certification filter actually needs it to
  // restrict rows. Reusing `extraJoins` here was previously turning every count into ~750K
  // extra index lookups against posters/tmdb_details for data the query throws away.
  const countJoins = needsDetailsJoin ? "INNER JOIN tmdb_details td ON td.imdbId = t.imdbId" : "";

  const whereClause = conditions.join(" AND ");

  let orderBy;
  if (searchQuery) {
    if (sortBy === "rating") {
      orderBy = "rating DESC, votes DESC";
    } else if (sortBy === "year") {
      orderBy = "year DESC, votes DESC";
    } else {
      // Default: balance relevance with popularity for "most votes" sort.
      // FTS5 bm25() returns negative scores (more negative = more relevant); negate it
      // and add a vote-based term so popular + relevant movies rank above obscure exact hits.
      orderBy = "(-fts_m.ftsRank + COALESCE(votes, 0) / 10000.0) DESC, votes DESC";
    }
  } else {
    orderBy = sortBy === "rating" ? "rating DESC, votes DESC" : sortBy === "year" ? "year DESC, votes DESC" : "votes DESC, rating DESC";
  }

  const limit = Math.min(parseInt(pageSize, 10) || 50, 200); // Cap at 200 for performance
  // When paging through a country filter, the client passes back the server's `nextOffset`
  // (raw DB row offset) instead of `page`, since matches don't line up 1:1 with pages.
  const offset =
    req.query.offset !== undefined
      ? parseInt(req.query.offset, 10) || 0
      : (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  // A LEFT JOIN to posters/tmdb_details is cheap per-row, but with a large OFFSET, SQLite must
  // still evaluate it for every *skipped* row before it can even apply LIMIT/OFFSET — so at
  // offset ~744,500 (page ~14,891 of the default browse) it was doing ~1.5M extra index probes
  // just to reach the last page (measured 60s+ hang; without the joins, the same offset takes
  // ~160ms). Splitting this into "find the matching imdbIds for this page" (no poster/detail
  // joins — only `countJoins`, since a certification filter needs it to restrict which rows
  // match at all) and "enrich those <=200 ids with poster/detail data" keeps the join cost
  // proportional to the page size, not the offset depth.
  const idSql = `SELECT t.imdbId AS imdbId ${fromClause} ${countJoins} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

  const mapRow = (r) => ({
    ...r,
    genres: r.genres.split(",").filter(Boolean),
    countries: r.countries ? r.countries.split(",").filter(Boolean) : [],
  });
  const stripInternal = (r) => {
    const { needsPosterFetch, ...rest } = r;
    return rest;
  };

  function enrichByIds(imdbIds) {
    if (!imdbIds.length) return [];
    const placeholders = imdbIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT t.imdbId, t.title, t.year, t.runtimeMinutes, t.genres, t.rating, t.votes, t.titleType,
                p.tmdbId AS tmdbId, p.posterUrl AS posterUrl, td.certification AS certification, td.countries AS countries, td.overview AS overview,
                CASE WHEN p.imdbId IS NULL THEN 1 ELSE 0 END AS needsPosterFetch
         FROM titles t ${extraJoins} WHERE t.imdbId IN (${placeholders})`
      )
      .all(...imdbIds);
    const byId = new Map(rows.map((r) => [r.imdbId, r]));
    return imdbIds.map((id) => byId.get(id)).filter(Boolean);
  }

  if (!countryList.length) {
    // A genre filter is a `genres LIKE '%,X,%'` condition — no index can satisfy a leading-
    // wildcard LIKE, so counting it means a full scan of every isAdult+titleType match checking
    // that substring (~1s now that the DB is served from RAM; it was 30s+ on disk, which is why
    // this used to skip the exact count entirely). That's a fine one-time cost for a correct
    // "page 1 of 32" instead of the misleading "page 1 of 2" the approximate lower-bound
    // produced — it only ever showed "one page past wherever you currently are," never the real
    // total, however many times you clicked Next. A capped FTS match count (see above) is a
    // different, correctness-driven reason a text search still can't guarantee an exact count.
    const needsExactCount = !searchQuery;
    const idRows = db.prepare(idSql).all(...withFtsParams(params), limit + 1, offset);
    const hasMore = idRows.length > limit;
    const pageRows = enrichByIds(idRows.slice(0, limit).map((r) => r.imdbId)).map(mapRow);
    backgroundFillExtras(pageRows.filter((r) => r.needsPosterFetch));

    const total = needsExactCount
      ? db.prepare(`SELECT COUNT(*) AS c ${fromClause} ${countJoins} WHERE ${whereClause}`).get(...withFtsParams(params)).c
      : offset + pageRows.length + (hasMore ? 1 : 0);

    return res.json({
      total,
      page: Number(page),
      pageSize: limit,
      hasMore,
      approximate: !needsExactCount,
      results: pageRows.map(stripInternal),
    });
  }

  // Country filtering (rare case): countries live in the same cached join as everything
  // else now, so this is a pure DB scan — no live TMDb calls block the response anymore.
  const BATCH = 200;
  const MAX_BATCHES = 50;
  let scanOffset = offset;
  const matches = [];
  const toBackgroundFill = [];
  let reachedEnd = false;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const idRows = db.prepare(idSql).all(...withFtsParams(params), BATCH, scanOffset);
    if (!idRows.length) {
      reachedEnd = true;
      break;
    }
    const batchRows = enrichByIds(idRows.map((r) => r.imdbId)).map(mapRow);
    for (const r of batchRows) if (r.needsPosterFetch) toBackgroundFill.push(r);
    matches.push(...batchRows.filter((m) => m.countries.some((c) => countryList.includes(c))));
    scanOffset += batchRows.length;
    if (batchRows.length < BATCH) {
      reachedEnd = true;
      break;
    }
    if (matches.length >= limit) break;
  }

  backgroundFillExtras(toBackgroundFill);

  const paginatedResults = matches.slice(0, limit).map(stripInternal);
  const actualTotal = matches.length;
  const stoppedEarly = !reachedEnd && matches.length >= limit;
  const hasMore = stoppedEarly || matches.length > limit;

  res.json({
    total: stoppedEarly ? matches.length + 1 : actualTotal,
    page: Number(page),
    pageSize: limit,
    hasMore,
    nextOffset: scanOffset,
    approximate: !reachedEnd,
    results: paginatedResults,
  });
});

// --- Semantic ("AI") search --------------------------------------------------------------
// Runs entirely in-process: a local sentence-transformer model (via @huggingface/transformers,
// WASM backend, no native build step) embeds the query, and cosine similarity is computed in a
// tight JS loop against an in-memory copy of the `movie_embeddings_local` table loaded at
// startup. No subprocess, no WSL dependency, no separate/stale database — this is the same
// data/movies.db the rest of the app uses, so it also works inside the deployed container.
//
// Filterable metadata (titleType/rating/votes/year/runtime/genres/certification) for the
// embedded titles is loaded into memory alongside the vectors at startup too, and filters are
// applied with a plain JS predicate (matchesFiltersInMemory) rather than a per-request SQL
// join. A naive `titles INNER JOIN movie_embeddings_local` join measured 12-50s per call in
// testing: the query planner drives it from `titles` (12.6M rows) instead of the much smaller
// embeddings table (100K rows), so every semantic search would've done ~12M index probes. Doing
// that join once at boot (CROSS JOIN forces the correct join order) and filtering the resulting
// ~100K in-memory records per request instead turns that into microseconds per search.
let embeddingPipeline = null;
let embeddingIndex = null; // { imdbIds, vectors: Float32Array, norms: Float32Array, dim, position: Map, meta: [...] }
let semanticSearchReady = false;

async function initSemanticSearch() {
  try {
    const rows = db
      .prepare(
        `SELECT e.imdbId, e.embedding, t.titleType, t.rating, t.votes, t.year, t.runtimeMinutes, t.genres, td.certification
         FROM movie_embeddings_local e
         CROSS JOIN titles t ON t.imdbId = e.imdbId
         LEFT JOIN tmdb_details td ON td.imdbId = e.imdbId
         WHERE t.isAdult = 0`
      )
      .all();
    if (!rows.length) {
      console.warn("No rows in movie_embeddings_local — semantic search disabled.");
      return;
    }

    const dim = rows[0].embedding.byteLength / 4;
    const vectors = new Float32Array(rows.length * dim);
    const norms = new Float32Array(rows.length);
    const imdbIds = new Array(rows.length);
    const meta = new Array(rows.length);
    const position = new Map();

    rows.forEach((row, i) => {
      // Copy into a fresh, 4-byte-aligned ArrayBuffer — better-sqlite3's BLOB Buffers can have
      // a byteOffset that isn't a multiple of 4, which Float32Array construction requires.
      const bytes = row.embedding;
      const vec = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      vectors.set(vec, i * dim);
      let sumSq = 0;
      for (let j = 0; j < dim; j++) sumSq += vec[j] * vec[j];
      norms[i] = Math.sqrt(sumSq);
      imdbIds[i] = row.imdbId;
      position.set(row.imdbId, i);
      meta[i] = {
        titleType: row.titleType,
        rating: row.rating,
        votes: row.votes,
        year: row.year,
        runtimeMinutes: row.runtimeMinutes,
        genresList: row.genres ? row.genres.split(",").filter(Boolean) : [],
        certification: row.certification,
      };
    });

    embeddingIndex = { imdbIds, vectors, norms, dim, position, meta };
    console.log(`Semantic search: loaded ${rows.length.toLocaleString()} embeddings (dim ${dim}) into memory.`);

    console.log("Semantic search: loading local embedding model (Xenova/all-MiniLM-L6-v2)...");
    const { pipeline } = await import("@huggingface/transformers");
    embeddingPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });

    semanticSearchReady = true;
    console.log("Semantic search ready.");
  } catch (err) {
    console.error("Semantic search init failed — falling back to keyword search only:", err.message);
    semanticSearchReady = false;
  }
}
initSemanticSearch();

async function embedQuery(text) {
  const output = await embeddingPipeline(text, { pooling: "mean", normalize: false });
  return Float32Array.from(output.data);
}

function cosineSimilaritySearch(queryVec, parsedFilters, topN) {
  const { imdbIds, vectors, norms, dim, meta } = embeddingIndex;
  let qNorm = 0;
  for (let i = 0; i < dim; i++) qNorm += queryVec[i] * queryVec[i];
  qNorm = Math.sqrt(qNorm) || 1;

  const scored = [];
  for (let i = 0; i < imdbIds.length; i++) {
    if (!matchesFiltersInMemory(meta[i], parsedFilters)) continue;
    const offset = i * dim;
    let dot = 0;
    for (let j = 0; j < dim; j++) dot += queryVec[j] * vectors[offset + j];
    scored.push({ imdbId: imdbIds[i], similarity: dot / (qNorm * (norms[i] || 1)) });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}

// Turns a list of {imdbId, similarity} into full result objects (title/poster/etc.), preserving
// the input's order and rank, and kicks off a background cache-fill for any missing posters.
// Shared by /api/semantic-search and /api/similar/:imdbId — same enrichment either way, the
// only difference is where the (imdbId, similarity) pairs came from.
// json_each(?) takes the whole id list as a single bound parameter — unlike a plain
// `IN (?,?,?...)`, this isn't subject to SQLite's 32,766-variable cap, so it stays a single
// query no matter how many results were requested (measured 50,000 ids in ~40ms).
function enrichScoredResults(scored) {
  if (!scored.length) return [];
  const detailRows = db
    .prepare(
      `SELECT t.imdbId, t.title, t.year, t.rating, t.votes, t.titleType, t.genres,
              p.posterUrl AS posterUrl, td.overview AS overview, td.certification AS certification,
              CASE WHEN p.imdbId IS NULL THEN 1 ELSE 0 END AS needsPosterFetch
       FROM titles t
       LEFT JOIN posters p ON p.imdbId = t.imdbId
       LEFT JOIN tmdb_details td ON td.imdbId = t.imdbId
       WHERE t.imdbId IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(scored.map((s) => s.imdbId)));

  const similarityById = new Map(scored.map((s) => [s.imdbId, s.similarity]));
  const byId = new Map(detailRows.map((r) => [r.imdbId, r]));
  const results = scored
    .map((s) => byId.get(s.imdbId))
    .filter(Boolean)
    .map((r) => ({
      ...r,
      genres: r.genres ? r.genres.split(",").filter(Boolean) : [],
      similarity: similarityById.get(r.imdbId),
    }));

  backgroundFillExtras(results.filter((r) => r.needsPosterFetch));
  results.forEach((r) => {
    delete r.needsPosterFetch;
  });
  return results;
}

// No filter restrictions — used for "more like this", which should be able to surface a similar
// TV series for a movie (or vice versa) rather than being pinned to parseFilterParams' movie-only
// default.
const NO_FILTERS = {
  types: [],
  minRatingVal: 0,
  maxRatingVal: 10,
  minVotesVal: 0,
  maxVotesVal: null,
  minYearVal: null,
  maxYearVal: null,
  minRuntimeVal: null,
  maxRuntimeVal: null,
  genreList: [],
  genreMode: "any",
  certs: [],
};

app.get("/api/semantic-search", async (req, res) => {
  const { q = "", limit = "20" } = req.query;
  const query = q.trim();

  if (!query) return res.json({ total: 0, results: [] });

  if (!semanticSearchReady) {
    return res.status(503).json({
      error: "Semantic search not ready",
      details: "The embedding model is still loading. Try again shortly or use keyword search.",
    });
  }

  const maxResults = Math.min(parseInt(limit, 10) || 20, 20000);

  try {
    // Same filter params as keyword search (genres/rating/votes/year/runtime/type/certification),
    // applied in memory against the embedded-titles index so semantic search can be scoped just
    // like a normal browse — new capability, the old subprocess implementation ignored all filters.
    const parsedFilters = parseFilterParams(req.query);
    const queryVec = await embedQuery(query);
    const scored = cosineSimilaritySearch(queryVec, parsedFilters, maxResults);
    const results = enrichScoredResults(scored);
    res.json({ total: results.length, results, semantic: true });
  } catch (error) {
    console.error("Semantic search error:", error.message);
    res.status(500).json({ error: "Semantic search failed", details: error.message });
  }
});

// "More like this" — nearest neighbors to a specific title's embedding, rather than a typed
// query. Uses the title's own stored embedding directly when it has one (best quality, no model
// call needed); falls back to embedding its title+genres on the fly for the ~92% of titles
// outside the embedded set, so the feature still works for those, just at slightly lower quality.
app.get("/api/similar/:imdbId", async (req, res) => {
  const { imdbId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 50);

  if (!semanticSearchReady) {
    return res.status(503).json({
      error: "Semantic search not ready",
      details: "The embedding model is still loading. Try again shortly.",
    });
  }

  try {
    const { vectors, dim, position } = embeddingIndex;
    let queryVec;

    const idx = position.get(imdbId);
    if (idx !== undefined) {
      queryVec = vectors.slice(idx * dim, idx * dim + dim);
    } else {
      const row = db.prepare(`SELECT title, genres FROM titles WHERE imdbId = ?`).get(imdbId);
      if (!row) return res.status(404).json({ error: "Movie not found" });
      const genres = row.genres ? row.genres.split(",").filter(Boolean).join(", ") : "";
      queryVec = await embedQuery(`${row.title}. Genres: ${genres}`);
    }

    const scored = cosineSimilaritySearch(queryVec, NO_FILTERS, limit + 1).filter((s) => s.imdbId !== imdbId);
    const results = enrichScoredResults(scored.slice(0, limit));
    res.json({ results });
  } catch (error) {
    console.error("Similar-movies error:", error.message);
    res.status(500).json({ error: "Failed to find similar movies", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Movie search running at http://localhost:${PORT}`);
  if (!TMDB_API_KEY) console.warn("TMDB_API_KEY not set — posters will be blank. Set it via env var.");
});
