import "./TypeSortBar.css";

export default function TypeSortBar({ search }) {
  const { filters, setTitleType, setSortBy, togglePg13, statusMessage, loading } = search;

  return (
    <div className="status-bar">
      <div className="status">{loading ? "Loading..." : statusMessage}</div>
      <div className="filter-buttons">
        <div className="button-group">
          <span className="group-label">Type:</span>
          <button className={`filter-btn${filters.titleType === "movie" ? " active" : ""}`} onClick={() => setTitleType("movie")}>
            Movies
          </button>
          <button className={`filter-btn${filters.titleType === "tvSeries" ? " active" : ""}`} onClick={() => setTitleType("tvSeries")}>
            TV Series
          </button>
          <button className={`filter-btn${filters.titleType === "all" ? " active" : ""}`} onClick={() => setTitleType("all")}>
            All
          </button>
        </div>
        <div className="button-group">
          <span className="group-label">Sort:</span>
          <button className={`filter-btn${filters.sortBy === "votes" ? " active" : ""}`} onClick={() => setSortBy("votes")}>
            Most Popular
          </button>
          <button className={`filter-btn${filters.sortBy === "rating" ? " active" : ""}`} onClick={() => setSortBy("rating")}>
            Highest Rated
          </button>
        </div>
        <div className="button-group">
          <span className="group-label">Rating:</span>
          <button className={`filter-btn${filters.pg13 ? " active" : ""}`} onClick={togglePg13}>
            PG-13 &amp; Under
          </button>
        </div>
      </div>
    </div>
  );
}
