async function getJson(url, signal) {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.details = body.details;
    throw err;
  }
  return res.json();
}

export function fetchGenres() {
  return getJson("/api/genres");
}

export function fetchAutocomplete(query, signal) {
  return getJson(`/api/autocomplete?q=${encodeURIComponent(query)}`, signal);
}

export function fetchSearch(params, signal) {
  return getJson(`/api/search?${params.toString()}`, signal);
}

export function fetchSemanticSearch(params, signal) {
  return getJson(`/api/semantic-search?${params.toString()}`, signal);
}

export function fetchMovie(imdbId, signal) {
  return getJson(`/api/movie/${encodeURIComponent(imdbId)}`, signal);
}
