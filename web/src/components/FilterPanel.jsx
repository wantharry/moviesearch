import "./FilterPanel.css";

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function FilterPanel({ search, genreOptions, countryOptions, open, onClose }) {
  const { filters, setFilters, applyFilters } = search;

  function update(key, value) {
    setFilters({ ...filters, [key]: value });
  }

  function handleApply() {
    applyFilters();
    onClose();
  }

  return (
    <aside className={`filters${open ? " open" : ""}`}>
      <div className="filters-header">
        <span>Filters</span>
        <button className="filter-close" aria-label="Close filters" onClick={onClose}>
          &times;
        </button>
      </div>

      <details className="filter-group" open>
        <summary>
          Genres <span className="count">{filters.genres.length || ""}</span>
        </summary>
        <div className="chip-list">
          {genreOptions.map((genre) => (
            <label className="chip" key={genre}>
              <input
                type="checkbox"
                checked={filters.genres.includes(genre)}
                onChange={() => update("genres", toggleValue(filters.genres, genre))}
              />
              {genre}
            </label>
          ))}
        </div>
        <div className="genre-mode">
          <label>
            <input type="radio" name="genreMode" checked={filters.genreMode === "all"} onChange={() => update("genreMode", "all")} />
            All of them
          </label>
          <label>
            <input type="radio" name="genreMode" checked={filters.genreMode === "any"} onChange={() => update("genreMode", "any")} />
            Any of them
          </label>
        </div>
      </details>

      <details className="filter-group">
        <summary>Rating &amp; votes</summary>
        <div className="compact-grid">
          <label className="mini-label">
            Rating min
            <input type="number" inputMode="decimal" min="0" max="10" step="0.1" value={filters.minRating} onChange={(e) => update("minRating", e.target.value)} />
          </label>
          <label className="mini-label">
            Rating max
            <input type="number" inputMode="decimal" min="0" max="10" step="0.1" value={filters.maxRating} onChange={(e) => update("maxRating", e.target.value)} />
          </label>
          <label className="mini-label">
            Votes min
            <input type="number" inputMode="numeric" min="0" placeholder="min" value={filters.minVotes} onChange={(e) => update("minVotes", e.target.value)} />
          </label>
          <label className="mini-label">
            Votes max
            <input type="number" inputMode="numeric" min="0" placeholder="any" value={filters.maxVotes} onChange={(e) => update("maxVotes", e.target.value)} />
          </label>
        </div>
      </details>

      <details className="filter-group">
        <summary>Year &amp; runtime</summary>
        <div className="compact-grid">
          <label className="mini-label">
            Year min
            <input type="number" inputMode="numeric" placeholder="min" value={filters.minYear} onChange={(e) => update("minYear", e.target.value)} />
          </label>
          <label className="mini-label">
            Year max
            <input type="number" inputMode="numeric" placeholder="max" value={filters.maxYear} onChange={(e) => update("maxYear", e.target.value)} />
          </label>
          <label className="mini-label">
            Runtime min
            <input type="number" inputMode="numeric" placeholder="min" value={filters.minRuntime} onChange={(e) => update("minRuntime", e.target.value)} />
          </label>
          <label className="mini-label">
            Runtime max
            <input type="number" inputMode="numeric" placeholder="max" value={filters.maxRuntime} onChange={(e) => update("maxRuntime", e.target.value)} />
          </label>
        </div>
      </details>

      <details className="filter-group">
        <summary>
          Country <span className="count">{filters.countries.length || ""}</span>
        </summary>
        <div className="chip-list">
          {countryOptions.map((country) => (
            <label className="chip" key={country.code}>
              <input
                type="checkbox"
                checked={filters.countries.includes(country.code)}
                onChange={() => update("countries", toggleValue(filters.countries, country.code))}
              />
              {country.label}
            </label>
          ))}
        </div>
      </details>

      <button className="apply-button" type="button" onClick={handleApply}>
        Apply Filters
      </button>
    </aside>
  );
}
