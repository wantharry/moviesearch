import { useEffect, useState } from "react";
import { fetchMovie, fetchSimilarMovies } from "../api.js";
import "./MovieModal.css";

export default function MovieModal({ movie, onClose, onSelect }) {
  const [details, setDetails] = useState(null);
  const [failed, setFailed] = useState(false);
  const [similar, setSimilar] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    setDetails(null);
    setFailed(false);
    setSimilar(null);

    const controller = new AbortController();
    fetchMovie(movie.imdbId, controller.signal)
      .then(setDetails)
      .catch((err) => {
        if (err.name !== "AbortError") setFailed(true);
      });
    fetchSimilarMovies(movie.imdbId, controller.signal)
      .then((data) => setSimilar(data.results))
      .catch((err) => {
        if (err.name !== "AbortError") setSimilar([]);
      });

    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      controller.abort();
    };
  }, [movie.imdbId, onClose]);

  const posterUrl = (details?.posterUrl || movie.posterUrl)?.replace("/w342", "/w500");

  return (
    <div className="modal open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        <div className="modal-body">
          {posterUrl && <img className="modal-poster" src={posterUrl} alt={movie.title} />}
          <div className="modal-info">
            <h2>{movie.title}</h2>
            <div className="modal-meta">
              <span>{movie.year ?? "—"}</span>
              <span>★ {movie.rating ?? "—"}</span>
              <span>{details?.certification || (failed ? "" : details === null ? "Loading..." : "")}</span>
            </div>
            <p>
              {failed
                ? "Failed to load details."
                : details === null
                  ? "Loading details..."
                  : details.overview || "No description available."}
            </p>
            <a
              className="modal-imdb-link"
              href={`https://www.imdb.com/title/${movie.imdbId}/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on IMDb &rarr;
            </a>
          </div>
        </div>

        {similar === null ? (
          <div className="modal-similar">
            <h3>More Like This</h3>
            <p className="modal-similar-loading">Finding similar movies...</p>
          </div>
        ) : similar.length > 0 ? (
          <div className="modal-similar">
            <h3>More Like This</h3>
            <div className="modal-similar-grid">
              {similar.map((m) => (
                <div className="modal-similar-card" key={m.imdbId} onClick={() => onSelect(m)}>
                  {m.posterUrl ? (
                    <img src={m.posterUrl} alt={m.title} loading="lazy" />
                  ) : (
                    <div className="modal-similar-no-poster">No poster</div>
                  )}
                  <div className="modal-similar-title" title={m.title}>
                    {m.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
