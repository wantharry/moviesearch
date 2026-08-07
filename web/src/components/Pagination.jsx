import { useEffect, useState } from "react";
import "./Pagination.css";

export default function Pagination({ search }) {
  const {
    page,
    totalPages,
    total,
    approximate,
    isSemanticResult,
    loading,
    goToPrevPage,
    goToNextPage,
    goToPage,
    goToLastPage,
    hasMore,
  } = search;

  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  if (isSemanticResult || total === 0) return null;

  const canJump = !approximate && totalPages > 1;

  function submitPageInput() {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) goToPage(n);
    else setPageInput(String(page));
  }

  return (
    <div className="pagination">
      <button className="page-btn" onClick={goToPrevPage} disabled={loading || page <= 1}>
        &larr; Prev
      </button>

      {canJump ? (
        <span className="page-jump">
          Page{" "}
          <input
            className="page-input"
            type="number"
            min="1"
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPageInput()}
            onBlur={submitPageInput}
            disabled={loading}
          />{" "}
          of {totalPages.toLocaleString()}
        </span>
      ) : (
        <span className="page-label">
          Page {page} of {totalPages.toLocaleString()}
        </span>
      )}

      <button className="page-btn" onClick={goToNextPage} disabled={loading || !hasMore}>
        Next &rarr;
      </button>

      {canJump && (
        <button className="page-btn" onClick={goToLastPage} disabled={loading || page >= totalPages}>
          Last &raquo;
        </button>
      )}
    </div>
  );
}
