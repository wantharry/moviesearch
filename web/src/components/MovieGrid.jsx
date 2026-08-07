import MovieCard from "./MovieCard.jsx";
import "./MovieGrid.css";

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-poster" />
      <div className="skeleton-info">
        <div className="skeleton-title" />
        <div className="skeleton-meta" />
      </div>
    </div>
  );
}

export default function MovieGrid({ results, loading, onSelect }) {
  if (loading && results.length === 0) {
    return (
      <div className="skeleton-container">
        {Array.from({ length: 20 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!loading && results.length === 0) {
    return <p className="empty-state">No movies match these filters. Try widening your search.</p>;
  }

  return (
    <div className="grid">
      {results.map((movie, index) => (
        <MovieCard key={movie.imdbId} movie={movie} onSelect={onSelect} style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }} />
      ))}
    </div>
  );
}
