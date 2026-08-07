# IMDb movie picker pipeline

Gets movies filtered by genre / rating / vote count / runtime — like IMDb's
[advanced title search](https://www.imdb.com/search/title/) — using IMDb's own
official data dumps (real ratings & vote counts) plus TMDb for poster images.
No scraping: IMDb's site actively blocks bots (AWS WAF), so this uses IMDb's
published non-commercial dataset instead.

## 1. Download IMDb's dataset (one-time, re-run occasionally to refresh)

```
node scripts/download-datasets.js
```

Downloads `title.basics.tsv.gz` and `title.ratings.tsv.gz` into `data/`.

## 2. Filter locally (instant, no network calls, no rate limits)

```
node scripts/filter-movies.js --genres=Action,Adventure --genre-mode=any --min-rating=6 --min-votes=3000 --limit=200
```

Options:
- `--genres` comma list, e.g. `Action,Adventure`
- `--genre-mode` `any` (OR, default) or `all` (AND)
- `--title-types` default `movie` (also: `tvMovie,tvSeries,tvEpisode,short,video,videoGame,tvMiniSeries,tvSpecial,tvShort`)
- `--min-rating` / `--max-rating` (0-10)
- `--min-votes` / `--max-votes`
- `--min-year` / `--max-year`
- `--min-runtime` / `--max-runtime` (minutes)
- `--include-adult` (flag, off by default)
- `--sort-by` `votes` (default) or `rating`
- `--limit` max results, default 500
- `--out` output filename in `data/`, default `filtered-movies.json`

## 3. Fetch poster images from TMDb (rate-limited, resumable)

Get a free API key at https://www.themoviedb.org/settings/api, then:

```
node scripts/fetch-posters.js --api-key=YOUR_KEY --delay=30000
```

Makes one TMDb request every 30 seconds (configurable via `--delay`, in ms).
Saves progress after every movie to `data/movies-with-posters.json`, so you
can stop (Ctrl+C) and re-run later — it skips movies already fetched.

You can also set the key once via an environment variable instead of `--api-key`:

```
$env:TMDB_API_KEY = "YOUR_KEY"
```

## Notes / limitations

Not available from IMDb's free non-commercial dataset (would need scraping the
live site, which is blocked, or IMDb's paid commercial license): certificates
(PG-13/R), plot keywords, awards, exact release dates, popularity rank, box
office numbers, production companies, country/language filters.
