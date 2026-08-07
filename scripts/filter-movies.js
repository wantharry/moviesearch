// Filters IMDb's local dataset dumps by title type, rating, vote count, and genre(s).
// Mirrors the filters from imdb.com/search/title (title_type, user_rating, num_votes, genres)
// but uses real IMDb numbers from the downloaded dataset instead of scraping the site.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { parseArgs } = require("util");

const DATA_DIR = path.join(__dirname, "..", "data");

const { values: args } = parseArgs({
  options: {
    genres: { type: "string", default: "" }, // e.g. "Action,Adventure"
    "genre-mode": { type: "string", default: "any" }, // "any" (OR) or "all" (AND)
    "title-types": { type: "string", default: "movie" }, // e.g. "movie,tvMovie"
    "min-rating": { type: "string", default: "0" },
    "max-rating": { type: "string", default: "10" },
    "min-votes": { type: "string", default: "0" },
    "max-votes": { type: "string", default: "" },
    "min-year": { type: "string", default: "" },
    "max-year": { type: "string", default: "" },
    "min-runtime": { type: "string", default: "" },
    "max-runtime": { type: "string", default: "" },
    "include-adult": { type: "boolean", default: false },
    "sort-by": { type: "string", default: "votes" }, // "votes" or "rating"
    limit: { type: "string", default: "500" },
    out: { type: "string", default: "filtered-movies.json" },
  },
});

const wantedGenres = args.genres
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
const genreMode = args["genre-mode"];
const titleTypes = new Set(args["title-types"].split(",").map((t) => t.trim()));
const minRating = parseFloat(args["min-rating"]);
const maxRating = parseFloat(args["max-rating"]);
const minVotes = parseInt(args["min-votes"], 10);
const maxVotes = args["max-votes"] ? parseInt(args["max-votes"], 10) : Infinity;
const minYear = args["min-year"] ? parseInt(args["min-year"], 10) : -Infinity;
const maxYear = args["max-year"] ? parseInt(args["max-year"], 10) : Infinity;
const minRuntime = args["min-runtime"] ? parseInt(args["min-runtime"], 10) : -Infinity;
const maxRuntime = args["max-runtime"] ? parseInt(args["max-runtime"], 10) : Infinity;
const limit = parseInt(args.limit, 10);

function readTsvGz(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing ${filePath} — run download-datasets.js first`);
  }
  const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

function matchesGenres(rowGenres) {
  if (wantedGenres.length === 0) return true;
  const set = new Set(rowGenres.split(","));
  if (genreMode === "all") {
    return wantedGenres.every((g) => set.has(g));
  }
  return wantedGenres.some((g) => set.has(g));
}

async function loadPassingRatings() {
  const passing = new Map(); // tconst -> { rating, votes }
  const rl = readTsvGz("title.ratings.tsv.gz");
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const [tconst, averageRating, numVotes] = line.split("\t");
    const rating = parseFloat(averageRating);
    const votes = parseInt(numVotes, 10);
    if (rating >= minRating && rating <= maxRating && votes >= minVotes && votes <= maxVotes) {
      passing.set(tconst, { rating, votes });
    }
  }
  return passing;
}

async function filterBasics(passingRatings) {
  const results = [];
  const rl = readTsvGz("title.basics.tsv.gz");
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const [tconst, titleType, primaryTitle, , isAdult, startYear, , runtimeMinutes, genres] = line.split("\t");

    if (!titleTypes.has(titleType)) continue;
    if (!args["include-adult"] && isAdult === "1") continue;
    const ratingInfo = passingRatings.get(tconst);
    if (!ratingInfo) continue;

    const year = parseInt(startYear, 10);
    if (!Number.isNaN(year) && (year < minYear || year > maxYear)) continue;
    if (startYear === "\\N" && (minYear !== -Infinity || maxYear !== Infinity)) continue;

    const runtime = parseInt(runtimeMinutes, 10);
    if (!Number.isNaN(runtime) && (runtime < minRuntime || runtime > maxRuntime)) continue;
    if (runtimeMinutes === "\\N" && (minRuntime !== -Infinity || maxRuntime !== Infinity)) continue;

    if (!matchesGenres(genres === "\\N" ? "" : genres)) continue;

    results.push({
      imdbId: tconst,
      title: primaryTitle,
      year: Number.isNaN(year) ? null : year,
      runtimeMinutes: Number.isNaN(runtime) ? null : runtime,
      genres: genres === "\\N" ? [] : genres.split(","),
      rating: ratingInfo.rating,
      votes: ratingInfo.votes,
    });
  }
  return results;
}

async function main() {
  console.log("loading ratings...");
  const passingRatings = await loadPassingRatings();
  console.log(`titles passing rating/vote filter: ${passingRatings.size}`);

  console.log("scanning titles...");
  let results = await filterBasics(passingRatings);
  console.log(`titles matching all filters: ${results.length}`);

  results.sort((a, b) => (args["sort-by"] === "rating" ? b.rating - a.rating : b.votes - a.votes));
  results = results.slice(0, limit);

  const outPath = path.join(DATA_DIR, args.out);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`wrote ${results.length} movies to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
