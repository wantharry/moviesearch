export default function MovieCard({ movie, onSelect, style }) {
  const genresText = movie.genres?.length ? movie.genres.join(", ") : "";

  return (
    <div className="card" style={style} onClick={() => onSelect(movie)}>
      {movie.posterUrl ? (
        <img src={movie.posterUrl} alt={movie.title} loading="lazy" />
      ) : (
        <div className="no-poster">No poster</div>
      )}
      <div className="info">
        <div className="title" title={movie.title}>
          {movie.title}
        </div>
        <div className="meta">
          <span>{movie.year ?? "—"}</span>
          <span className="rating">★ {movie.rating ?? "—"}</span>
        </div>
        <div className="meta">
          <span>{(movie.votes ?? 0).toLocaleString()} votes</span>
          {movie.certification && <span>{movie.certification}</span>}
        </div>
        {genresText && <div className="genres">{genresText}</div>}
      </div>
    </div>
  );
}
