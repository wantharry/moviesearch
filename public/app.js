const state = {
  page: 1,
  pageSize: 100,
  hasMore: false,
  nextOffset: null,
  movies: [], // Store all loaded movies
  total: 0,
  totalPages: 0,
  currentSort: 'votes', // 'votes' or 'rating'
  allResults: [], // Store all results for client-side sorting
};

const els = {
  genreList: document.getElementById("genre-list"),
  countryList: document.getElementById("country-list"),
  titleTypes: document.getElementById("titleTypes"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  loadMore: document.getElementById("loadMore"),
  pagination: document.getElementById("pagination"),
  paginationTop: document.getElementById("paginationTop"),
  firstPage: document.getElementById("firstPage"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  lastPage: document.getElementById("lastPage"),
  pageSlider: document.getElementById("pageSlider"),
  currentPage: document.getElementById("currentPage"),
  totalPages: document.getElementById("totalPages"),
  firstPageTop: document.getElementById("firstPageTop"),
  prevPageTop: document.getElementById("prevPageTop"),
  nextPageTop: document.getElementById("nextPageTop"),
  lastPageTop: document.getElementById("lastPageTop"),
  pageSliderTop: document.getElementById("pageSliderTop"),
  currentPageTop: document.getElementById("currentPageTop"),
  totalPagesTop: document.getElementById("totalPagesTop"),
  apply: document.getElementById("apply"),
  filters: document.getElementById("filters"),
  filterToggle: document.getElementById("filterToggle"),
  filterClose: document.getElementById("filterClose"),
  filterOverlay: document.getElementById("filterOverlay"),
  searchInput: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  autocomplete: document.getElementById("autocomplete"),
  sortButtons: document.getElementById("sortButtons"),
  sortByVotes: document.getElementById("sortByVotes"),
  sortByRating: document.getElementById("sortByRating"),
  useSemanticSearch: document.getElementById("useSemanticSearch"),
};

function openFilters() {
  els.filters.classList.add("open");
  els.filterOverlay.classList.add("open");
}

function closeFilters() {
  els.filters.classList.remove("open");
  els.filterOverlay.classList.remove("open");
}

function chip(value, label) {
  return `<label class="chip"><input type="checkbox" value="${value}" />${label}</label>`;
}

function formatTitleType(type) {
  // Convert camelCase to readable format
  // tvMovie -> TV Movie, tvSeries -> TV Series, etc.
  const formatted = type
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters
    .replace(/^tv/i, 'TV') // TV prefix
    .trim();
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

async function loadFilterOptions() {
  const res = await fetch("/api/genres");
  const { genres, titleTypes, countries } = await res.json();

  els.genreList.innerHTML = genres.map((g) => chip(g, g)).join("");
  // Certification filter removed - certs shown on cards only
  els.countryList.innerHTML = countries.map((c) => chip(c.code, c.label)).join("");

  els.titleTypes.innerHTML = titleTypes
    .map((t) => `<option value="${t}" ${t === "movie" ? "selected" : ""}>${formatTitleType(t)}</option>`)
    .join("");

  [els.genreList, els.countryList].forEach((list) =>
    list.addEventListener("change", updateCounts)
  );
  updateCounts();
}

function updateCounts() {
  document.getElementById("genreCount").textContent =
    els.genreList.querySelectorAll("input:checked").length || "";
  document.getElementById("countryCount").textContent =
    els.countryList.querySelectorAll("input:checked").length || "";
}

function buildQuery(page, offset) {
  const genres = [...els.genreList.querySelectorAll("input:checked")].map((el) => el.value).join(",");
  const genreMode = document.querySelector('input[name="genreMode"]:checked').value;
  let titleTypes = [...els.titleTypes.selectedOptions].map((o) => o.value).join(",");
  const countries = [...els.countryList.querySelectorAll("input:checked")].map((el) => el.value).join(",");
  const searchQuery = els.searchInput.value.trim();

  // When searching by text, include both movies and TV series by default
  if (searchQuery && titleTypes === "movie") {
    titleTypes = "movie,tvSeries";
  }

  const params = new URLSearchParams({
    genres,
    genreMode,
    titleTypes,
    countries,
    minRating: document.getElementById("minRating").value || "0",
    maxRating: document.getElementById("maxRating").value || "10",
    minVotes: document.getElementById("minVotes").value || "0",
    maxVotes: document.getElementById("maxVotes").value || "",
    minYear: document.getElementById("minYear").value || "",
    maxYear: document.getElementById("maxYear").value || "",
    minRuntime: document.getElementById("minRuntime").value || "",
    maxRuntime: document.getElementById("maxRuntime").value || "",
    sortBy: document.getElementById("sortBy").value,
    pageSize: String(state.pageSize),
    q: searchQuery,
  });
  if (offset !== undefined) params.set("offset", String(offset));
  else params.set("page", String(page));
  return params;
}

function renderCard(movie, index) {
  const poster = movie.posterUrl
    ? `<img src="${movie.posterUrl}" alt="${movie.title}" loading="lazy" />`
    : `<div class="no-poster">No poster</div>`;
  return `
    <div class="card" data-movie-index="${index}">
      ${poster}
      <div class="info">
        <div class="title" title="${movie.title}">${movie.title}</div>
        <div class="meta">
          <span>${movie.year ?? "—"}</span>
          <span class="rating">★ ${movie.rating ?? "—"}</span>
        </div>
        <div class="meta">
          <span>${movie.votes?.toLocaleString() ?? "0"} votes</span>
          ${movie.certification ? `<span>${movie.certification}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderSkeletonCards(count = 20) {
  const skeletons = [];
  for (let i = 0; i < count; i++) {
    skeletons.push(`
      <div class="skeleton-card">
        <div class="skeleton-poster"></div>
        <div class="skeleton-info">
          <div class="skeleton-title"></div>
          <div class="skeleton-meta"></div>
        </div>
      </div>
    `);
  }
  return `<div class="skeleton-container">${skeletons.join('')}</div>`;
}

async function search(page = 1, append = false, offset = undefined) {
  // Clear state AND UI immediately when not appending - this ensures updatePagination hides controls
  if (!append) {
    state.movies = [];
    state.allResults = [];
    state.total = 0;  // Reset total so updatePagination() will hide pagination
    els.results.innerHTML = renderSkeletonCards(20);
    els.sortButtons.hidden = true; // Hide sort buttons while loading
  }
  
  els.status.textContent = "Loading...";
  els.loadMore.hidden = true;
  // Force hide pagination during loading
  els.pagination.hidden = true;
  els.paginationTop.hidden = true;

  const searchQuery = els.searchInput.value.trim();
  
  // Use semantic search only if enabled and has text query
  const useSemanticSearch = els.useSemanticSearch.checked && searchQuery && !append;
  
  if (useSemanticSearch) {
    els.status.textContent = "🤖 AI semantic search...";
    try {
      // Set 10 second timeout for semantic search (model is pre-loaded, should be fast)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(`/api/semantic-search?q=${encodeURIComponent(searchQuery)}&limit=10000`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error('Semantic search failed');
      
      const data = await res.json();
      
      if (data.error) {
        // Fall back to keyword search
        console.warn('Semantic search error, falling back to keyword search:', data.error);
        await keywordSearch(page, append, offset);
        return;
      }
      
      // Store all results for client-side sorting
      state.allResults = data.results;
      state.total = data.results.length;
      state.totalPages = 1; // All results loaded at once
      state.hasMore = false;
      
      // Apply current sort
      applySortToResults();
      
      // Show sort buttons
      els.sortButtons.hidden = false;
      
      els.status.textContent = `🤖 Found ${data.results.length} movies using AI search`;
      updatePagination();
      return;
    } catch (e) {
      console.error('Semantic search error:', e);
      els.status.textContent = "AI search unavailable, using keyword search...";
      // Fall back to keyword search
      await keywordSearch(page, append, offset);
      return;
    }
  }
  
  // Use regular keyword search
  await keywordSearch(page, append, offset);
}

async function keywordSearch(page = 1, append = false, offset = undefined) {
  const params = buildQuery(page, offset);
  const res = await fetch(`/api/search?${params.toString()}`);
  if (!res.ok) {
    els.status.textContent = "Something went wrong.";
    els.results.innerHTML = "";
    return;
  }
  const data = await res.json();
  
  const startIndex = state.movies.length;
  state.movies.push(...data.results);
  
  // Replace skeleton with actual results
  if (!append) {
    els.results.innerHTML = "";
  }
  els.results.insertAdjacentHTML("beforeend", data.results.map((m, i) => renderCard(m, startIndex + i)).join(""));

  state.page = data.page;
  state.hasMore = data.hasMore;
  state.nextOffset = data.nextOffset ?? null;
  state.total = data.total;
  state.totalPages = Math.ceil(data.total / state.pageSize);
  
  els.status.textContent = data.approximate
    ? `${state.movies.length.toLocaleString()} results shown (certification data fetched on-demand)`
    : `${data.total.toLocaleString()} movies match`;
  
  updatePagination();
}

function updatePagination() {
  // Hide pagination if no results or no movies loaded yet
  if (state.total === 0 || state.movies.length === 0) {
    els.pagination.hidden = true;
    els.paginationTop.hidden = true;
    return;
  }
  
  els.pagination.hidden = false;
  els.paginationTop.hidden = false;
  els.loadMore.hidden = !state.hasMore;
  
  // Update page info for both top and bottom
  els.pageSlider.value = state.page;
  els.pageSlider.max = state.totalPages;
  els.currentPage.textContent = state.page;
  els.totalPages.textContent = state.totalPages.toLocaleString();
  
  els.pageSliderTop.value = state.page;
  els.pageSliderTop.max = state.totalPages;
  els.currentPageTop.textContent = state.page;
  els.totalPagesTop.textContent = state.totalPages.toLocaleString();
  
  // Enable/disable navigation buttons (bottom)
  els.firstPage.disabled = state.page === 1;
  els.prevPage.disabled = state.page === 1;
  els.nextPage.disabled = state.page >= state.totalPages;
  els.lastPage.disabled = state.page >= state.totalPages;
  
  // Enable/disable navigation buttons (top)
  els.firstPageTop.disabled = state.page === 1;
  els.prevPageTop.disabled = state.page === 1;
  els.nextPageTop.disabled = state.page >= state.totalPages;
  els.lastPageTop.disabled = state.page >= state.totalPages;
}

function goToPage(pageNum) {
  const page = Math.max(1, Math.min(pageNum, state.totalPages));
  if (page === state.page) return;
  search(page, false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

els.apply.addEventListener("click", () => {
  closeFilters();
  search(1, false);
});
els.loadMore.addEventListener("click", () =>
  state.nextOffset !== null ? search(undefined, true, state.nextOffset) : search(state.page + 1, true)
);
els.filterToggle.addEventListener("click", openFilters);
els.filterClose.addEventListener("click", closeFilters);
els.filterOverlay.addEventListener("click", closeFilters);

// Pagination controls (bottom)
els.firstPage.addEventListener("click", () => goToPage(1));
els.prevPage.addEventListener("click", () => goToPage(state.page - 1));
els.nextPage.addEventListener("click", () => goToPage(state.page + 1));
els.lastPage.addEventListener("click", () => goToPage(state.totalPages));
els.pageSlider.addEventListener("input", (e) => {
  const pageNum = parseInt(e.target.value, 10);
  els.currentPage.textContent = pageNum;
});
els.pageSlider.addEventListener("change", (e) => {
  const pageNum = parseInt(e.target.value, 10);
  if (!isNaN(pageNum)) goToPage(pageNum);
});

// Pagination controls (top)
els.firstPageTop.addEventListener("click", () => goToPage(1));
els.prevPageTop.addEventListener("click", () => goToPage(state.page - 1));
els.nextPageTop.addEventListener("click", () => goToPage(state.page + 1));
els.lastPageTop.addEventListener("click", () => goToPage(state.totalPages));
els.pageSliderTop.addEventListener("input", (e) => {
  const pageNum = parseInt(e.target.value, 10);
  els.currentPageTop.textContent = pageNum;
});
els.pageSliderTop.addEventListener("change", (e) => {
  const pageNum = parseInt(e.target.value, 10);
  if (!isNaN(pageNum)) goToPage(pageNum);
});

// Movie modal handling
const modal = document.getElementById("movieModal");
const modalClose = modal.querySelector(".modal-close");
const modalPoster = document.getElementById("modalPoster");
const modalTitle = document.getElementById("modalTitle");
const modalYear = document.getElementById("modalYear");
const modalRating = document.getElementById("modalRating");
const modalCert = document.getElementById("modalCert");
const modalOverview = document.getElementById("modalOverview");

function openModal(movie) {
  modalTitle.textContent = movie.title;
  modalYear.textContent = movie.year ?? "—";
  modalRating.textContent = `★ ${movie.rating ?? "—"}`;
  modalCert.textContent = "Loading...";
  modalOverview.textContent = "Loading details...";
  
  if (movie.posterUrl) {
    modalPoster.src = movie.posterUrl.replace("/w342", "/w500"); // Higher res for modal
    modalPoster.alt = movie.title;
    modalPoster.style.display = "block";
  } else {
    modalPoster.style.display = "none";
  }
  
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  
  // Fetch full details on-demand
  fetch(`/api/movie/${movie.imdbId}`)
    .then((res) => res.json())
    .then((details) => {
      modalCert.textContent = details.certification || "";
      modalOverview.textContent = details.overview || "No description available.";
      // Update poster with higher resolution if available
      if (details.posterUrl) {
        modalPoster.src = details.posterUrl.replace("/w342", "/w500");
      }
    })
    .catch((err) => {
      console.error("Failed to fetch movie details:", err);
      modalCert.textContent = "";
      modalOverview.textContent = "Failed to load details.";
    });
}

function closeModal() {
  modal.classList.remove("open");
  document.body.style.overflow = "";
}

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
});

// Delegate click events on cards
els.results.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  
  const index = parseInt(card.dataset.movieIndex, 10);
  const movie = state.movies[index];
  if (movie) openModal(movie);
});

// Search and autocomplete functionality
let autocompleteController = null;
let selectedAutocompleteIndex = -1;

async function fetchAutocomplete(query) {
  if (!query || query.length < 2) {
    els.autocomplete.hidden = true;
    return;
  }

  if (autocompleteController) autocompleteController.abort();
  autocompleteController = new AbortController();

  try {
    const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`, {
      signal: autocompleteController.signal
    });
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.results.length === 0) {
      els.autocomplete.hidden = true;
      return;
    }

    els.autocomplete.innerHTML = data.results.map((movie, index) => `
      <div class="autocomplete-item" data-index="${index}" data-title="${movie.title}">
        ${movie.posterUrl 
          ? `<img src="${movie.posterUrl}" alt="${movie.title}" loading="lazy" />` 
          : '<div class="no-poster-small">No poster</div>'
        }
        <div class="autocomplete-info">
          <div class="autocomplete-title">${movie.title}</div>
          <div class="autocomplete-meta">
            ${movie.year || '—'} • <span class="autocomplete-rating">★ ${movie.rating || '—'}</span>
          </div>
        </div>
      </div>
    `).join('');
    
    els.autocomplete.hidden = false;
    selectedAutocompleteIndex = -1;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Autocomplete fetch error:', error);
    }
  }
}

let searchDebounceTimer;
els.searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  els.clearSearch.hidden = !query;
  
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchAutocomplete(query), 300);
});

els.searchInput.addEventListener("keydown", (e) => {
  const items = els.autocomplete.querySelectorAll(".autocomplete-item");
  
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
    updateAutocompleteSelection(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
    updateAutocompleteSelection(items);
  } else if (e.key === "Enter") {
    if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
      e.preventDefault();
      items[selectedAutocompleteIndex].click();
    } else if (els.searchInput.value.trim()) {
      e.preventDefault();
      els.autocomplete.hidden = true;
      search(1, false);
    }
  } else if (e.key === "Escape") {
    els.autocomplete.hidden = true;
  }
});

function updateAutocompleteSelection(items) {
  items.forEach((item, index) => {
    item.classList.toggle("selected", index === selectedAutocompleteIndex);
    if (index === selectedAutocompleteIndex) {
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

els.autocomplete.addEventListener("click", (e) => {
  const item = e.target.closest(".autocomplete-item");
  if (!item) return;
  
  const title = item.dataset.title;
  els.searchInput.value = title;
  els.clearSearch.hidden = false;
  els.autocomplete.hidden = true;
  search(1, false);
});

els.clearSearch.addEventListener("click", () => {
  els.searchInput.value = "";
  els.clearSearch.hidden = true;
  els.autocomplete.hidden = true;
  search(1, false);
});

// Close autocomplete when clicking outside
document.addEventListener("click", (e) => {
  if (!els.searchInput.contains(e.target) && !els.autocomplete.contains(e.target)) {
    els.autocomplete.hidden = true;
  }
});

// Client-side sorting functions
function applySortToResults() {
  if (!state.allResults.length) return;
  
  let sorted = [...state.allResults];
  
  if (state.currentSort === 'rating') {
    sorted.sort((a, b) => {
      // Sort by rating DESC, then votes DESC
      const ratingDiff = (b.rating || 0) - (a.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      return (b.votes || 0) - (a.votes || 0);
    });
  } else {
    // Sort by votes DESC (default)
    sorted.sort((a, b) => {
      const votesDiff = (b.votes || 0) - (a.votes || 0);
      if (votesDiff !== 0) return votesDiff;
      return (b.rating || 0) - (a.rating || 0);
    });
  }
  
  state.movies = sorted;
  
  // Re-render results
  els.results.innerHTML = sorted.map((m, i) => renderCard(m, i)).join("");
  
  // Update button states
  els.sortByVotes.classList.toggle('active', state.currentSort === 'votes');
  els.sortByRating.classList.toggle('active', state.currentSort === 'rating');
}

els.sortByVotes.addEventListener('click', () => {
  if (state.currentSort === 'votes') return; // Already sorted
  state.currentSort = 'votes';
  applySortToResults();
});

els.sortByRating.addEventListener('click', () => {
  if (state.currentSort === 'rating') return; // Already sorted
  state.currentSort = 'rating';
  applySortToResults();
});

// Initialize state and hide pagination before first search to prevent flash during loading
els.pagination.hidden = true;
els.paginationTop.hidden = true;
state.movies = [];
state.total = 0;

loadFilterOptions().then(() => search(1, false));
