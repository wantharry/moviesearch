// Downloads IMDb's official non-commercial data dumps (real ratings/votes/genres).
// Source: https://datasets.imdbws.com/ (docs: https://developer.imdb.com/non-commercial-datasets/)
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILES = ["title.basics.tsv.gz", "title.ratings.tsv.gz"];

async function download(name, force) {
  const dest = path.join(DATA_DIR, name);
  if (fs.existsSync(dest) && !force) {
    console.log(`skip (already exists): ${name}`);
    return;
  }
  const url = `https://datasets.imdbws.com/${name}`;
  console.log(`downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  console.log(`saved: ${dest}`);
}

async function main() {
  const force = process.argv.includes("--force");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of FILES) {
    await download(f, force);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
