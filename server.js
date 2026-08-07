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
const DB_PATH = path.join(DATA_DIR, "movies.db");
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const PORT = process.env.PORT || 3000;

const GENRES = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "Film-Noir", "Game-Show", "History", "Horror", "Music",
  "Musical", "Mystery", "News", "Reality-TV", "Romance", "Sci-Fi", "Short", "Sport",
  "Talk-Show", "Thriller", "War", "Western",
];

const TITLE_TYPES = ["movie", "tvMovie", "tvSeries", "tvMiniSeries", "tvSpecial", "short", "video", "videoGame", "tvShort"];
const TV_TITLE_TYPES = new Set(["tvSeries", "tvMiniSeries", "tvSpecial", "tvShort"]);

const CERTIFICATIONS = ["PG-13", "R"];

// Map simplified certifications to underlying TMDb values
const CERT_MAPPING = {
  "PG-13": ["G", "PG", "PG-13", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "NR", null], // includes unrated/unknown
  "R": ["R", "NC-17", "TV-MA"],
};

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
db.exec(`CREATE TABLE IF NOT EXISTS posters (imdbId TEXT PRIMARY KEY, tmdbId INTEGER, posterUrl TEXT, fetchedAt INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS tmdb_details (imdbId TEXT PRIMARY KEY, certification TEXT, countries TEXT, overview TEXT, fetchedAt INTEGER)`);

// Migration: Add overview column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE tmdb_details ADD COLUMN overview TEXT`);
} catch (e) {
  // Column already exists, ignore
}

const getCachedPoster = db.prepare("SELECT tmdbId, posterUrl FROM posters WHERE imdbId = ?");
const savePoster = db.prepare(
  "INSERT INTO posters (imdbId, tmdbId, posterUrl, fetchedAt) VALUES (@imdbId, @tmdbId, @posterUrl, @fetchedAt) " +
  "ON CONFLICT(imdbId) DO UPDATE SET tmdbId=excluded.tmdbId, posterUrl=excluded.posterUrl, fetchedAt=excluded.fetchedAt"
);
const getCachedDetails = db.prepare("SELECT certification, countries, overview FROM tmdb_details WHERE imdbId = ?");
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
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return tmdbFetch(urlPath, retries);
  }
  tmdbRequestCount++;

  const sep = urlPath.includes("?") ? "&" : "?";
  const url = isV4Token ? `https://api.themoviedb.org/3${urlPath}` : `https://api.themoviedb.org/3${urlPath}${sep}api_key=${TMDB_API_KEY}`;
  
  try {
    const res = await fetch(url, isV4Token ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } } : undefined);
    
    // Handle rate limiting
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      console.warn(`TMDb rate limit hit, retrying after ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
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
  if (cached) return { certification: cached.certification, countries: cached.countries ? cached.countries.split(",").filter(Boolean) : [], overview: cached.overview || null };

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
async function attachExtras(movies, { withDetails = false, concurrency = 5 } = {}) {
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

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/genres", (req, res) => {
  res.json({ genres: GENRES, titleTypes: TITLE_TYPES, certifications: CERTIFICATIONS, countries: COUNTRIES });
});

app.get("/api/search", async (req, res) => {
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
    sortBy = "votes",
    page = "1",
    pageSize = "50",
    certifications = "",
    countries = "",
  } = req.query;

  const certList = certifications.split(",").map((c) => c.trim()).filter((c) => CERTIFICATIONS.includes(c));
  // Expand simplified cert selections to actual TMDb values
  const expandedCerts = certList.flatMap((c) => CERT_MAPPING[c] || []);
  const countryList = countries.split(",").map((c) => c.trim()).filter((c) => COUNTRY_CODES.has(c));

  const conditions = [];
  const params = [];
  
  // Handle rating filter - allow NULL if minRating is 0
  const minRatingVal = parseFloat(minRating);
  const maxRatingVal = parseFloat(maxRating);
  if (minRatingVal > 0) {
    conditions.push("rating >= ?");
    params.push(minRatingVal);
  } else {
    conditions.push("(rating IS NULL OR rating >= ?)");
    params.push(minRatingVal);
  }
  conditions.push("(rating IS NULL OR rating <= ?)");
  params.push(maxRatingVal);
  
  // Handle votes filter - allow NULL if minVotes is 0
  const minVotesVal = parseInt(minVotes, 10) || 0;
  if (minVotesVal > 0) {
    conditions.push("votes >= ?");
    params.push(minVotesVal);
  } else {
    conditions.push("(votes IS NULL OR votes >= ?)");
    params.push(minVotesVal);
  }

  if (maxVotes) {
    conditions.push("(votes IS NULL OR votes <= ?)");
    params.push(parseInt(maxVotes, 10));
  }
  if (minYear) {
    conditions.push("year >= ?");
    params.push(parseInt(minYear, 10));
  }
  if (maxYear) {
    conditions.push("year <= ?");
    params.push(parseInt(maxYear, 10));
  }
  if (minRuntime) {
    conditions.push("runtimeMinutes >= ?");
    params.push(parseInt(minRuntime, 10));
  }
  if (maxRuntime) {
    conditions.push("runtimeMinutes <= ?");
    params.push(parseInt(maxRuntime, 10));
  }
  
  // Always exclude adult content
  conditions.push("isAdult = 0");

  const types = titleTypes.split(",").map((t) => t.trim()).filter((t) => TITLE_TYPES.includes(t));
  if (types.length) {
    conditions.push(`titleType IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }

  const genreList = genres.split(",").map((g) => g.trim()).filter((g) => GENRES.includes(g));
  if (genreList.length) {
    const genreConds = genreList.map(() => "genres LIKE ?");
    params.push(...genreList.map((g) => `%,${g},%`));
    conditions.push(`(${genreConds.join(genreMode === "all" ? " AND " : " OR ")})`);
  }

  const whereClause = conditions.join(" AND ");
  const orderBy = sortBy === "rating" ? "rating DESC, votes DESC" : sortBy === "year" ? "year DESC, votes DESC" : "votes DESC, rating DESC";
  const limit = Math.min(parseInt(pageSize, 10) || 50, 100);
  // When paging through a certification filter, the client passes back the server's
  // `nextOffset` (raw DB row offset) instead of `page`, since matches don't line up 1:1 with pages.
  const offset = req.query.offset !== undefined
    ? parseInt(req.query.offset, 10) || 0
    : (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM titles WHERE ${whereClause}`).get(...params).c;
  const selectSql = `SELECT imdbId, title, year, runtimeMinutes, genres, rating, votes, titleType FROM titles WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

  if (!expandedCerts.length && !countryList.length) {
    const rows = db.prepare(selectSql).all(...params, limit, offset).map((r) => ({ ...r, genres: r.genres.split(",").filter(Boolean) }));
    await attachExtras(rows, { withDetails: true });
    return res.json({ total, page: Number(page), pageSize: limit, hasMore: offset + rows.length < total, results: rows });
  }

  // Certification/country of origin aren't in the local dataset — they have to be looked up (and
  // cached) from TMDb per title, so we scan candidate batches from the DB, fetch+filter, and keep
  // going until we have enough matches or run out of candidates. `total`/pagination become approximate.
  const BATCH = 100;
  const MAX_BATCHES = 50; // Increased from 10 to handle 12.7M title database
  let scanOffset = offset;
  const matches = [];
  let reachedEnd = false;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const batchRows = db
      .prepare(selectSql)
      .all(...params, BATCH, scanOffset)
      .map((r) => ({ ...r, genres: r.genres.split(",").filter(Boolean) }));
    if (!batchRows.length) {
      reachedEnd = true;
      break;
    }
    await attachExtras(batchRows, { withDetails: true });
    matches.push(
      ...batchRows.filter((m) => {
        if (expandedCerts.length && !expandedCerts.includes(m.certification)) return false;
        if (countryList.length && !m.countries.some((c) => countryList.includes(c))) return false;
        return true;
      })
    );
    scanOffset += batchRows.length;
    if (batchRows.length < BATCH) {
      reachedEnd = true;
      break;
    }
    if (matches.length >= limit) break;
  }

  res.json({
    total,
    page: Number(page),
    pageSize: limit,
    hasMore: !reachedEnd && scanOffset < total,
    nextOffset: scanOffset,
    approximate: true,
    results: matches,
  });
});

app.listen(PORT, () => {
  console.log(`Movie search running at http://localhost:${PORT}`);
  if (!TMDB_API_KEY) console.warn("TMDB_API_KEY not set — posters will be blank. Set it via env var.");
});
