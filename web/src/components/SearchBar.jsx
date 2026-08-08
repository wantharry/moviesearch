import { useEffect, useRef, useState } from "react";
import { fetchAutocomplete } from "../api.js";
import "./SearchBar.css";

export default function SearchBar({ search, onOpenMovie }) {
  const { query, setQuery, useSemanticSearch, setUseSemanticSearch, submitSearch, clearSearch } = search;
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const abortRef = useRef(null);
  const wrapperRef = useRef(null);
  // A debounced autocomplete fetch can still be in flight when the user submits (Enter),
  // selects a suggestion, or clears the box — without this, that fetch resolves shortly
  // after and reopens the dropdown on top of the just-updated results. Set on any of those
  // explicit actions, cleared the moment the user types again.
  const suppressRef = useRef(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await fetchAutocomplete(trimmed, controller.signal);
        if (suppressRef.current) return;
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setSelectedIndex(-1);
      } catch (err) {
        if (err.name !== "AbortError") setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function closeSuggestions() {
    suppressRef.current = true;
    setOpen(false);
  }

  function handleChange(e) {
    suppressRef.current = false;
    setQuery(e.target.value);
  }

  // Selecting an autocomplete suggestion opens that specific movie directly (a fast, tiny
  // /api/movie/:id fetch) rather than launching a whole new AI search "for movies like this
  // one" — that was both slow (a multi-MB response for the large default result count) and
  // not what clicking a specific title in a dropdown implies.
  function handleSelect(movie) {
    closeSuggestions();
    setQuery(movie.title);
    onOpenMovie(movie);
  }

  // A raw "Enter" keydown on a text input isn't reliably fired by every mobile keyboard (the
  // "Go"/"Search" key on the virtual keyboard doesn't always synthesize one) — wrapping the
  // input in a <form> and submitting it is the standard, cross-platform way to catch that key,
  // and it also gives us a real Search button for a tap target regardless. The keydown handler
  // now only needs to special-case selecting a highlighted suggestion (which must NOT submit).
  function handleSubmit(e) {
    e.preventDefault();
    closeSuggestions();
    submitSearch();
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIndex >= 0 && suggestions[selectedIndex]) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  }

  return (
    <div className="search-container">
      <form className="search-wrapper" onSubmit={handleSubmit} ref={wrapperRef}>
        <div className="search-input-group">
          <input
            type="search"
            className="search-input"
            placeholder="Search movies by title..."
            autoComplete="off"
            enterKeyHint="search"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
          />
          {query && (
            <button
              type="button"
              className="clear-search"
              aria-label="Clear search"
              onClick={() => { closeSuggestions(); clearSearch(); }}
            >
              &times;
            </button>
          )}
          {open && (
            <div className="autocomplete">
              {suggestions.map((movie, index) => (
                <div
                  key={movie.imdbId}
                  className={`autocomplete-item${index === selectedIndex ? " selected" : ""}`}
                  onClick={() => handleSelect(movie)}
                >
                  {movie.posterUrl ? (
                    <img src={movie.posterUrl} alt={movie.title} loading="lazy" />
                  ) : (
                    <div className="no-poster-small">No poster</div>
                  )}
                  <div className="autocomplete-info">
                    <div className="autocomplete-title">{movie.title}</div>
                    <div className="autocomplete-meta">
                      {movie.year ?? "—"} • <span className="autocomplete-rating">★ {movie.rating ?? "—"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="search-submit" aria-label="Search">
          Search
        </button>
      </form>
      <div className="search-mode">
        <label className="search-mode-toggle">
          <input type="checkbox" checked={useSemanticSearch} onChange={(e) => setUseSemanticSearch(e.target.checked)} />
          <span>🤖 AI Search (understands meaning)</span>
        </label>
      </div>
    </div>
  );
}
