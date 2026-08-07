import "./Header.css";

export default function Header({ onToggleFilters }) {
  return (
    <header className="app-header">
      <h1>🎬 Movie Search</h1>
      <button className="filter-toggle" onClick={onToggleFilters} aria-label="Toggle filters">
        Filters
      </button>
    </header>
  );
}
