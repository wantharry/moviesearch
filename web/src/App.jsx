import { useEffect, useState } from "react";
import { fetchGenres } from "./api.js";
import { useMovieSearch } from "./hooks/useMovieSearch.js";
import Header from "./components/Header.jsx";
import SearchBar from "./components/SearchBar.jsx";
import FilterPanel from "./components/FilterPanel.jsx";
import TypeSortBar from "./components/TypeSortBar.jsx";
import MovieGrid from "./components/MovieGrid.jsx";
import Pagination from "./components/Pagination.jsx";
import MovieModal from "./components/MovieModal.jsx";
import "./App.css";

export default function App() {
  const search = useMovieSearch();
  const [genreOptions, setGenreOptions] = useState([]);
  const [countryOptions, setCountryOptions] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState(null);

  useEffect(() => {
    fetchGenres().then((data) => {
      setGenreOptions(data.genres);
      setCountryOptions(data.countries);
    });
  }, []);

  return (
    <>
      <Header onToggleFilters={() => setFiltersOpen(true)} />
      <SearchBar search={search} />
      <div className="layout">
        {filtersOpen && <div className="filter-overlay open" onClick={() => setFiltersOpen(false)} />}
        <FilterPanel
          search={search}
          genreOptions={genreOptions}
          countryOptions={countryOptions}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />
        <main className="main-content">
          <TypeSortBar search={search} />
          <Pagination search={search} />
          <MovieGrid results={search.results} loading={search.loading} onSelect={setSelectedMovie} />
          <Pagination search={search} />
        </main>
      </div>
      {selectedMovie && <MovieModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} onSelect={setSelectedMovie} />}
    </>
  );
}
