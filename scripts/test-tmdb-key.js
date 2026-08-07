const path = require("path");
process.loadEnvFile(path.join(__dirname, "..", ".env"));
const key = process.env.TMDB_API_KEY || "";
console.log("key length:", key.length, "starts with:", key.slice(0, 4));

fetch(`https://api.themoviedb.org/3/find/tt0086190?external_source=imdb_id&api_key=${key}`)
  .then(async (res) => {
    console.log("status:", res.status);
    const text = await res.text();
    console.log("body:", text.slice(0, 500));
  })
  .catch((err) => console.error("fetch error:", err));
