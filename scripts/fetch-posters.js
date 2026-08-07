// Looks up poster images from TMDb for each IMDb title, one request per --delay ms (default 30s).
// Progress is saved after every single movie so it can be safely stopped and resumed.
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const DATA_DIR = path.join(__dirname, "..", "data");

const { values: args } = parseArgs({
  options: {
    in: { type: "string", default: "filtered-movies.json" },
    out: { type: "string", default: "movies-with-posters.json" },
    delay: { type: "string", default: "30000" }, // ms between TMDb calls
    "api-key": { type: "string", default: process.env.TMDB_API_KEY || "" },
  },
});

const delayMs = parseInt(args.delay, 10);
const apiKey = args["api-key"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findByImdbId(imdbId) {
  // TMDb issues two key formats: a short v3 api_key (query param) and a long
  // v4 "read access token" JWT (Bearer header). Support whichever was pasted.
  const isV4Token = apiKey.split(".").length === 3;
  const url = isV4Token
    ? `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`
    : `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${apiKey}`;
  const res = await fetch(url, isV4Token ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);
  if (!res.ok) throw new Error(`TMDb request failed for ${imdbId}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.movie_results?.[0] || null;
}

async function main() {
  if (!apiKey) {
    console.error("Missing TMDb API key. Pass --api-key=... or set TMDB_API_KEY env var.");
    console.error("Get a free key at https://www.themoviedb.org/settings/api");
    process.exit(1);
  }

  const inPath = path.join(DATA_DIR, args.in);
  const outPath = path.join(DATA_DIR, args.out);

  const movies = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const done = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : [];
  const doneIds = new Set(done.map((m) => m.imdbId));

  const remaining = movies.filter((m) => !doneIds.has(m.imdbId));
  console.log(`${done.length} already fetched, ${remaining.length} remaining`);

  for (const [index, movie] of remaining.entries()) {
    console.log(`[${index + 1}/${remaining.length}] ${movie.title} (${movie.imdbId})`);
    try {
      const match = await findByImdbId(movie.imdbId);
      done.push({
        ...movie,
        tmdbId: match?.id ?? null,
        posterUrl: match?.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null,
      });
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      done.push({ ...movie, tmdbId: null, posterUrl: null });
    }

    fs.writeFileSync(outPath, JSON.stringify(done, null, 2));

    if (index < remaining.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log(`done. wrote ${done.length} movies to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
