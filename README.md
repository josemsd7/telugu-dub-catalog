# Telugu Dubs — Latest OTT

A free catalog-only Stremio add-on for Indian films reported as available with Telugu audio, excluding Telugu originals. It combines release listings from **OTTReleaseMovies, Trendraja and Sacnilk** and refreshes automatically every six hours. A second, separate catalog now covers Indian series and TV shows listed with Telugu audio, with the same exclusion of Telugu originals.

## Install

Open https://josemsd7.github.io/telugu-dub-catalog/ and click **Install in Stremio**. Existing installations keep the same catalog ID and manifest URL:

```text
https://josemsd7.github.io/telugu-dub-catalog/manifest.json
```

No playback, provider login, debrid service, paid API, API key or additional account is required. GitHub Actions runs the updates independently of ChatGPT or any OpenAI API.

## Two separate catalogs

The same manifest exposes **Available in Telugu** (`movie/telugu-dubbed`) and **Available in Telugu — Series & TV** (`series/telugu-dubbed-series`). Reinstall the add-on from the existing install page if Stremio has cached the old one-catalog manifest. Movies never enter the series response, and series never enter the movie response.

The series catalog combines OTTReleaseMovies and Trendraja series rows with [Sacnilk’s public series/season cards](https://www.sacnilk.com/entertainmenttopbar/Recent_WebSeries). It uses Cinemeta series identities, Wikidata TV IDs and public TMDB **TV** pages; films with matching names or numeric TMDB movie IDs are not used as shows. Source-listed season numbers must exist in released Cinemeta episodes. Telugu originals and non-Indian series are excluded, matching the existing film scope. Unknown or conflicting matches stay excluded. Available cast/host facts are shared across matching publisher rows to distinguish regional adaptations. For Indian series, an English-original field from TMDB alone needs publisher or Wikidata corroboration; validation found English defaults on Telugu originals.

There is one entry per IMDb series ID. Ordering uses the latest source-listed season release, taking the earliest reported date within each season. Source evidence is season-specific: a listed Telugu season does not confirm all seasons or all episodes. Live channels are outside this catalog. Static hosting supports browsing and pagination, not dynamic search.

Series sources and identity caches are stored separately in `data/series.json`. Series refresh failure preserves the previous series snapshot. Both catalogs refresh on the existing six-hour workflow and use hosted poster images.

- [Series source status and freshness](https://josemsd7.github.io/telugu-dub-catalog/series/status.json)
- [Series coverage and exclusions](https://josemsd7.github.io/telugu-dub-catalog/series/coverage.json)

## Movie discovery and coverage

The latest-releases catalog covers a **rolling 365 days of source-listed OTT dates**. The publisher pages can contain older archives; those older rows are outside this catalog's scope.

- **OTTReleaseMovies:** its factual release table, including dubbing direction, dates, platforms and cast.
- **Trendraja:** its Telugu OTT release table, including dates, platforms and Film/Series categories. The table's Telugu context is an audio-availability report, not evidence that a film was originally Telugu.
- **Sacnilk:** public OTT movie cards, their platform and availability-language fields, and public pagination. Pages run at concurrency two and stop after the recent window. Movie-page year hints help avoid matching a different-year remake. A safety limit of 50 pages prevents runaway pagination.
- **SV Telugu OTT:** the supplied URL returned HTTP 403 to automated requests during validation on October 23, 2026. No unverified live adapter or cached search-engine results are used for it.

Only factual metadata is extracted. Article prose and publisher platform artwork are not republished.

Coverage is not exhaustive. These websites can omit films, report wrong dates or audio languages, or disagree. The add-on does not inspect actual audio tracks or verify subscriptions and availability in the viewer's country. Missing or ambiguous film identities remain excluded.

## Identity, original languages and ordering

1. Exclude missing, tentative, future and subtitle-only dates, series, reality shows and explicit Telugu originals.
2. Match movie titles or supplied aliases to Cinemeta. Check Indian origin using Cinemeta, Wikidata or the matching TMDB movie page’s structured countryOfOrigin facts, country consistency, cast when the publisher lists it, movie-year hints when available, and identity ambiguity.
3. Use Wikidata original-language metadata, or the **Original Language** field of the matching public TMDB page. Check its numeric movie ID and title. An explicit publisher label such as `Tamil to Telugu` is the final fallback. Unknown or conflicting originals stay excluded. Any confirmed Telugu original-language value causes exclusion, including bilingual Telugu originals.
4. Merge accepted listings by IMDb movie ID. Combine platforms and source links, keeping one catalog entry per film.
5. Sort newest first using the **earliest reported Telugu OTT date across accepted listings**. This avoids promoting an old film solely because a second source or platform lists a later date. This is a reported date, not independently proven first-ever availability. Differing dates for the same platform remain visible in the coverage report.
6. Download real poster images under 100 kB and serve them from this add-on's own HTTPS host. Try alternate images before using a clearly identified placeholder. A total image-source outage stops deployment.

## Automatic updates and failures

GitHub Actions fetches sources every six hours and publishes static JSON and poster files through GitHub Pages. Scheduled jobs can be delayed. No manual list syncing is needed.

Each source has its own factual snapshot. If one source fails, its last successful recent rows are retained while other sources update. A failed Sacnilk page retains prior rows while reporting partial pagination. If all release sources fail, or the verified catalog is empty, publication stops and the previous deployment remains available. A publisher layout change may require a parser update; this automates normal refreshes and does not promise zero future maintenance.

Successful title searches, film metadata, Wikidata original languages and TMDB language facts are cached for seven days. Empty searches and missing Wikidata language identities retry after six hours. Transient failed lookups are cached for one hour to avoid repeatedly querying the same unavailable record; normal six-hour updates retry them. Missing country metadata can use the matching TMDB page’s explicit countryOfOrigin facts, without inferring origin from cast or language. Unknown and conflicting matches are excluded rather than guessed.

- [Source status, freshness, platform counts and limits](https://josemsd7.github.io/telugu-dub-catalog/status.json)
- [Included films, source listings, date disagreements and exclusions](https://josemsd7.github.io/telugu-dub-catalog/coverage.json)
- [Workflow runs](https://github.com/josemsd7/telugu-dub-catalog/actions/workflows/catalog.yml)

## Run locally

Requires Node.js 22+ and Python 3 with its standard library. There are no npm dependencies or API keys.

```sh
npm start
```

Use the printed manifest URL in Stremio desktop on the same computer. The process binds to `127.0.0.1` and must stay running for local use. Phone and TV devices should use hosted HTTPS.

```sh
npm test
npm run verify
npm run build
```

For a local static build, set `ADDON_BASE_URL` to the directory URL where `public/` will be served. GitHub Actions derives it from the repository name.

## Host another copy

GitHub Pages on the free plan requires a public repository. Publishing exposes the add-on code and factual catalog, not playback links or provider credentials.

1. Copy the repository into a public repository under your account.
2. Set **Settings → Pages → Source → GitHub Actions**.
3. Enable Actions and allow the workflow to write repository contents.
4. Run **Update and publish catalog** once. Later updates are automatic.

## Sources and code

- https://ottreleasemovies.com/
- https://trendraja.in/telugu-movie-ott-release-dates-2021/
- https://www.sacnilk.com/ott-movie-releases
- https://v3-cinemeta.strem.io/
- https://www.wikidata.org/
- https://www.themoviedb.org/
- https://stremio.github.io/stremio-addon-sdk/api/requests/defineCatalogHandler.html

The code is MIT licensed. Third-party metadata and artwork retain their respective ownership and terms. Source links are provided for factual release listings. This project does not claim endorsement by the publishers or streaming platforms.

