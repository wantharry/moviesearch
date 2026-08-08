import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSearch, fetchSemanticSearch } from "../api.js";

export const DEFAULT_FILTERS = {
  genres: [],
  genreMode: "all",
  minRating: "0",
  maxRating: "10",
  minVotes: "0",
  maxVotes: "",
  minYear: "",
  maxYear: "",
  minRuntime: "",
  maxRuntime: "",
  countries: [],
  titleType: "movie", // 'movie' | 'tvSeries' | 'all'
  sortBy: "relevance", // 'relevance' | 'votes' | 'rating' — relevance is a no-op sort placeholder
  // when there's no search query (server/semantic results are already in a sensible default
  // order in that case); it only does something once a query exists.
  pg13: false,
};

const PAGE_SIZE = 50;
const SEMANTIC_LIMIT = 50000;

function titleTypesFor(filters) {
  return filters.titleType === "all" ? "movie,tvSeries,tvMovie,tvMiniSeries,tvSpecial" : filters.titleType;
}

function buildFilterParams(filters) {
  return {
    genres: filters.genres.join(","),
    genreMode: filters.genreMode,
    titleTypes: titleTypesFor(filters),
    countries: filters.countries.join(","),
    minRating: filters.minRating || "0",
    maxRating: filters.maxRating || "10",
    minVotes: filters.minVotes || "0",
    maxVotes: filters.maxVotes || "",
    minYear: filters.minYear || "",
    maxYear: filters.maxYear || "",
    minRuntime: filters.minRuntime || "",
    maxRuntime: filters.maxRuntime || "",
    sortBy: filters.sortBy,
    certFilter: filters.pg13 ? "G,PG,PG-13,TV-G,TV-PG,TV-14" : "",
  };
}

// Only meaningful for semantic-search results, which carry a per-result `similarity` score —
// keyword search's "relevance" (bm25 blended with votes) is already applied server-side by
// default, so this only needs to handle re-sorting the client-side semantic result set.
function sortResults(list, sortBy) {
  const sorted = [...list];
  if (sortBy === "rating") {
    sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.votes || 0) - (a.votes || 0));
  } else if (sortBy === "votes") {
    sorted.sort((a, b) => (b.votes || 0) - (a.votes || 0) || (b.rating || 0) - (a.rating || 0));
  } else {
    sorted.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  }
  return sorted;
}

// Semantic search fetches up to SEMANTIC_LIMIT results in one request (already sorted by
// relevance server-side, then re-sortable by votes/rating client-side), but still paginates
// them PAGE_SIZE at a time in the UI — slicing an already-fetched array locally rather than
// re-querying the server for "next page".
function sliceSemanticPage(list, pageNum) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const clamped = Math.max(1, Math.min(Math.trunc(pageNum) || 1, totalPages));
  const start = (clamped - 1) * PAGE_SIZE;
  return {
    results: list.slice(start, start + PAGE_SIZE),
    page: clamped,
    totalPages,
    hasMore: clamped < totalPages,
  };
}

function paramsFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const filters = { ...DEFAULT_FILTERS };
  if (p.has("genres")) filters.genres = p.get("genres").split(",").filter(Boolean);
  if (p.has("genreMode")) filters.genreMode = p.get("genreMode");
  if (p.has("minRating")) filters.minRating = p.get("minRating");
  if (p.has("maxRating")) filters.maxRating = p.get("maxRating");
  if (p.has("minVotes")) filters.minVotes = p.get("minVotes");
  if (p.has("maxVotes")) filters.maxVotes = p.get("maxVotes");
  if (p.has("minYear")) filters.minYear = p.get("minYear");
  if (p.has("maxYear")) filters.maxYear = p.get("maxYear");
  if (p.has("minRuntime")) filters.minRuntime = p.get("minRuntime");
  if (p.has("maxRuntime")) filters.maxRuntime = p.get("maxRuntime");
  if (p.has("countries")) filters.countries = p.get("countries").split(",").filter(Boolean);
  if (p.has("type")) filters.titleType = p.get("type");
  if (p.has("sortBy")) filters.sortBy = p.get("sortBy");
  if (p.has("pg13")) filters.pg13 = p.get("pg13") === "1";
  return {
    query: p.get("q") || "",
    useSemanticSearch: p.has("ai") ? p.get("ai") === "1" : true,
    filters,
    page: p.has("page") ? Math.max(1, parseInt(p.get("page"), 10) || 1) : 1,
  };
}

function updateUrl({ query, useSemanticSearch, filters, page }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("ai", useSemanticSearch ? "1" : "0");
  if (filters.genres.length) params.set("genres", filters.genres.join(","));
  if (filters.genreMode !== DEFAULT_FILTERS.genreMode) params.set("genreMode", filters.genreMode);
  if (filters.minRating !== DEFAULT_FILTERS.minRating) params.set("minRating", filters.minRating);
  if (filters.maxRating !== DEFAULT_FILTERS.maxRating) params.set("maxRating", filters.maxRating);
  if (filters.minVotes !== DEFAULT_FILTERS.minVotes) params.set("minVotes", filters.minVotes);
  if (filters.maxVotes) params.set("maxVotes", filters.maxVotes);
  if (filters.minYear) params.set("minYear", filters.minYear);
  if (filters.maxYear) params.set("maxYear", filters.maxYear);
  if (filters.minRuntime) params.set("minRuntime", filters.minRuntime);
  if (filters.maxRuntime) params.set("maxRuntime", filters.maxRuntime);
  if (filters.countries.length) params.set("countries", filters.countries.join(","));
  if (filters.titleType !== DEFAULT_FILTERS.titleType) params.set("type", filters.titleType);
  if (filters.sortBy !== DEFAULT_FILTERS.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.pg13) params.set("pg13", "1");
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export function useMovieSearch() {
  const initial = useRef(paramsFromUrl()).current;

  const [query, setQuery] = useState(initial.query);
  const [useSemanticSearch, setUseSemanticSearchState] = useState(initial.useSemanticSearch);
  const [filters, setFilters] = useState(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [nextOffset, setNextOffset] = useState(null);

  const [results, setResults] = useState([]);
  const [allSemanticResults, setAllSemanticResults] = useState([]);
  const [isSemanticResult, setIsSemanticResult] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [approximate, setApproximate] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const abortRef = useRef(null);

  const runSearch = useCallback(
    async ({ pageArg = 1, offsetArg, queryOverride, semanticOverride, filtersOverride } = {}) => {
      const activeQuery = (queryOverride ?? query).trim();
      const activeSemantic = semanticOverride ?? useSemanticSearch;
      const activeFilters = filtersOverride ?? filters;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        if (activeSemantic && activeQuery) {
          const params = new URLSearchParams({ q: activeQuery, limit: String(SEMANTIC_LIMIT), ...buildFilterParams(activeFilters) });
          const data = await fetchSemanticSearch(params, controller.signal);
          const sorted = sortResults(data.results, activeFilters.sortBy);
          setAllSemanticResults(sorted);
          const firstPage = sliceSemanticPage(sorted, 1);
          setResults(firstPage.results);
          setIsSemanticResult(true);
          setTotal(sorted.length);
          setTotalPages(firstPage.totalPages);
          setApproximate(false);
          setHasMore(firstPage.hasMore);
          setPage(1);
          setStatusMessage(`🤖 Found ${sorted.length.toLocaleString()} contextually relevant movies`);
        } else {
          setIsSemanticResult(false);
          const filterParams = buildFilterParams(activeFilters);
          if (activeQuery && filterParams.titleTypes === "movie") filterParams.titleTypes = "movie,tvSeries";
          const params = new URLSearchParams({ ...filterParams, q: activeQuery, pageSize: String(PAGE_SIZE) });
          if (offsetArg !== undefined) params.set("offset", String(offsetArg));
          else params.set("page", String(pageArg));

          const data = await fetchSearch(params, controller.signal);
          setResults(data.results);
          setTotal(data.total);
          setTotalPages(Math.max(1, Math.ceil(data.total / PAGE_SIZE)));
          setApproximate(Boolean(data.approximate));
          setHasMore(data.hasMore);
          setNextOffset(data.nextOffset ?? null);
          setPage(data.page);
          setStatusMessage(
            data.approximate
              ? `${data.total.toLocaleString()}+ movies match (exact count skipped for this filter combination)`
              : `${data.total.toLocaleString()} movies match`
          );
        }
        updateUrl({ query: activeQuery, useSemanticSearch: activeSemantic, filters: activeFilters, page: pageArg });
      } catch (err) {
        if (err.name === "AbortError") return;
        setResults([]);
        setTotal(0);
        setStatusMessage(
          activeSemantic && err.status === 503
            ? "AI search is still warming up — try again shortly, or switch to keyword search."
            : "Something went wrong loading results."
        );
      } finally {
        setLoading(false);
      }
    },
    [query, useSemanticSearch, filters]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    runSearch({ pageArg: initial.page, queryOverride: initial.query, semanticOverride: initial.useSemanticSearch, filtersOverride: initial.filters });
  }, []);

  const submitSearch = useCallback(() => runSearch({ pageArg: 1 }), [runSearch]);

  // setQuery + runSearch back-to-back would read stale `query` state inside runSearch's
  // closure (state updates aren't visible until the next render), so these pass the new
  // value straight through as an override instead of relying on state having landed yet.
  const clearSearch = useCallback(() => {
    setQuery("");
    runSearch({ pageArg: 1, queryOverride: "" });
  }, [runSearch]);

  const selectAutocomplete = useCallback(
    (title) => {
      setQuery(title);
      runSearch({ pageArg: 1, queryOverride: title });
    },
    [runSearch]
  );

  const applyFilters = useCallback(() => runSearch({ pageArg: 1 }), [runSearch]);

  const setTitleType = useCallback(
    (titleType) => {
      const next = { ...filters, titleType };
      setFilters(next);
      runSearch({ pageArg: 1, filtersOverride: next });
    },
    [filters, runSearch]
  );

  const setSortBy = useCallback(
    (sortBy) => {
      const next = { ...filters, sortBy };
      setFilters(next);
      if (isSemanticResult) {
        const sorted = sortResults(allSemanticResults, sortBy);
        setAllSemanticResults(sorted);
        const firstPage = sliceSemanticPage(sorted, 1);
        setResults(firstPage.results);
        setPage(1);
        setTotalPages(firstPage.totalPages);
        setHasMore(firstPage.hasMore);
      } else {
        runSearch({ pageArg: 1, filtersOverride: next });
      }
    },
    [filters, isSemanticResult, allSemanticResults, runSearch]
  );

  const togglePg13 = useCallback(() => {
    const next = { ...filters, pg13: !filters.pg13 };
    setFilters(next);
    runSearch({ pageArg: 1, filtersOverride: next });
  }, [filters, runSearch]);

  const setUseSemanticSearch = useCallback(
    (value) => {
      setUseSemanticSearchState(value);
      if (query.trim()) runSearch({ pageArg: 1, semanticOverride: value });
    },
    [query, runSearch]
  );

  // Semantic-search pages are sliced client-side from the already-fetched allSemanticResults —
  // no network round-trip needed, unlike keyword search's page navigation below.
  const showSemanticPage = useCallback(
    (pageNum) => {
      const p = sliceSemanticPage(allSemanticResults, pageNum);
      setResults(p.results);
      setPage(p.page);
      setTotalPages(p.totalPages);
      setHasMore(p.hasMore);
    },
    [allSemanticResults]
  );

  const goToNextPage = useCallback(() => {
    if (!hasMore) return;
    if (isSemanticResult) return showSemanticPage(page + 1);
    if (nextOffset !== null) runSearch({ offsetArg: nextOffset, pageArg: page + 1 });
    else runSearch({ pageArg: page + 1 });
  }, [isSemanticResult, hasMore, nextOffset, page, runSearch, showSemanticPage]);

  const goToPrevPage = useCallback(() => {
    if (page <= 1) return;
    if (isSemanticResult) return showSemanticPage(page - 1);
    runSearch({ pageArg: page - 1 });
  }, [isSemanticResult, page, runSearch, showSemanticPage]);

  // Jumping to an arbitrary page (vs. just Prev/Next) only makes sense when totalPages is a
  // real count, not the approximate lower-bound used for genre/text-search filters (see
  // server.js) — that number keeps growing as you page forward, so "page 4200" wouldn't mean
  // anything stable there.
  const goToPage = useCallback(
    (pageNum) => {
      if (!isSemanticResult && approximate) return;
      const target = Math.max(1, Math.min(Math.trunc(pageNum) || 1, totalPages));
      if (target === page) return;
      if (isSemanticResult) return showSemanticPage(target);
      runSearch({ pageArg: target });
    },
    [isSemanticResult, approximate, totalPages, page, runSearch, showSemanticPage]
  );

  const goToLastPage = useCallback(() => goToPage(totalPages), [goToPage, totalPages]);

  return {
    query,
    setQuery,
    useSemanticSearch,
    setUseSemanticSearch,
    filters,
    setFilters,
    page,
    totalPages,
    total,
    approximate,
    hasMore,
    results,
    loading,
    statusMessage,
    isSemanticResult,
    submitSearch,
    clearSearch,
    selectAutocomplete,
    applyFilters,
    setTitleType,
    setSortBy,
    togglePg13,
    goToNextPage,
    goToPrevPage,
    goToPage,
    goToLastPage,
  };
}
