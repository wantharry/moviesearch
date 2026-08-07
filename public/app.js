const state = {
  page: 1,
  pageSize: 100,
  hasMore: false,
  nextOffset: null,
  movies: [], // Store all loaded movies
  total: 0,
  totalPages: 0,
};

const els = {
  genreList: document.getElementById("genre-list"),
  certList: document.getElementById("cert-list"),
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

async function loadFilterOptions() {
  const res = await fetch("/api/genres");
  const { genres, titleTypes, certifications, countries } = await res.json();

  els.genreList.innerHTML = genres.map((g) => chip(g, g)).join("");
  els.certList.innerHTML = certifications.map((c) => chip(c, c)).join("");
  els.countryList.innerHTML = countries.map((c) => chip(c.code, c.label)).join("");

  els.titleTypes.innerHTML = titleTypes
    .map((t) => `<option value="${t}" ${t === "movie" ? "selected" : ""}>${t}</option>`)
    .join("");

  [els.genreList, els.certList, els.countryList].forEach((list) =>
    list.addEventListener("change", updateCounts)
  );
  updateCounts();
}

function updateCounts() {
  document.getElementById("genreCount").textContent =
    els.genreList.querySelectorAll("input:checked").length || "";
  document.getElementById("certCount").textContent =
    els.certList.querySelectorAll("input:checked").length || "";
  document.getElementById("countryCount").textContent =
    els.countryList.querySelectorAll("input:checked").length || "";
}

function buildQuery(page, offset) {
  const genres = [...els.genreList.querySelectorAll("input:checked")].map((el) => el.value).join(",");
  const genreMode = document.querySelector('input[name="genreMode"]:checked').value;
  const titleTypes = [...els.titleTypes.selectedOptions].map((o) => o.value).join(",");
  const certifications = [...els.certList.querySelectorAll("input:checked")].map((el) => el.value).join(",");
  const countries = [...els.countryList.querySelectorAll("input:checked")].map((el) => el.value).join(",");

  const params = new URLSearchParams({
    genres,
    genreMode,
    titleTypes,
    certifications,
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

async function search(page = 1, append = false, offset = undefined) {
  els.status.textContent = "Loading...";
  els.loadMore.hidden = true;
  els.pagination.hidden = true;
  els.paginationTop.hidden = true;

  const params = buildQuery(page, offset);
  const res = await fetch(`/api/search?${params.toString()}`);
  if (!res.ok) {
    els.status.textContent = "Something went wrong.";
    return;
  }
  const data = await res.json();

  if (!append) {
    els.results.innerHTML = "";
    state.movies = [];
  }
  
  const startIndex = state.movies.length;
  state.movies.push(...data.results);
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
  if (state.total === 0) {
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
  modalCert.textContent = movie.certification || "";
  modalOverview.textContent = movie.overview || "No description available.";
  
  if (movie.posterUrl) {
    modalPoster.src = movie.posterUrl.replace("/w342", "/w500"); // Higher res for modal
    modalPoster.alt = movie.title;
    modalPoster.style.display = "block";
  } else {
    modalPoster.style.display = "none";
  }
  
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
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

loadFilterOptions().then(() => search(1, false));
