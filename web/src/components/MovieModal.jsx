import { useEffect, useState } from "react";
import { fetchMovie } from "../api.js";
import "./MovieModal.css";

export default function MovieModal({ movie, onClose }) {
  const [details, setDetails] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    setDetails(null);
    setFailed(false);

    const controller = new AbortController();
    fetchMovie(movie.imdbId, controller.signal)
      .then(setDetails)
      .catch((err) => {
        if (err.name !== "AbortError") setFailed(true);
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
          </div>
        </div>
      </div>
    </div>
  );
}
