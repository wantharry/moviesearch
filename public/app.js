const state = {
  page: 1,
  pageSize: 50,
  hasMore: false,
  nextOffset: null,
};

const els = {
  genreList: document.getElementById("genre-list"),
  certList: document.getElementById("cert-list"),
  countryList: document.getElementById("country-list"),
  titleTypes: document.getElementById("titleTypes"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  loadMore: document.getElementById("loadMore"),
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

async function loadFilterOptions() {
  const res = await fetch("/api/genres");
  const { genres, titleTypes, certifications, countries } = await res.json();

  els.genreList.innerHTML = genres
    .map((g) => `<label><input type="checkbox" value="${g}" /> ${g}</label>`)
    .join("");

  els.certList.innerHTML = certifications
    .map((c) => `<label><input type="checkbox" value="${c}" /> ${c}</label>`)
    .join("");

  els.countryList.innerHTML = countries
    .map((c) => `<label><input type="checkbox" value="${c.code}" /> ${c.label}</label>`)
    .join("");

  els.titleTypes.innerHTML = titleTypes
    .map((t) => `<option value="${t}" ${t === "movie" ? "selected" : ""}>${t}</option>`)
    .join("");
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

function renderCard(movie) {
  const poster = movie.posterUrl
    ? `<img src="${movie.posterUrl}" alt="${movie.title}" loading="lazy" />`
    : `<div class="no-poster">No poster</div>`;
  return `
    <div class="card">
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

  const params = buildQuery(page, offset);
  const res = await fetch(`/api/search?${params.toString()}`);
  if (!res.ok) {
    els.status.textContent = "Something went wrong.";
    return;
  }
  const data = await res.json();

  if (!append) els.results.innerHTML = "";
  els.results.insertAdjacentHTML("beforeend", data.results.map(renderCard).join(""));

  state.page = data.page;
  state.hasMore = data.hasMore;
  state.nextOffset = data.nextOffset ?? null;
  els.status.textContent = data.approximate
    ? `showing certification-matched results (exact total unavailable with this filter)`
    : `${data.total.toLocaleString()} movies match`;
  els.loadMore.hidden = !data.hasMore;
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

loadFilterOptions().then(() => search(1, false));
