# Telugu Dubs — Latest OTT

A free catalog-only Stremio add-on for Indian films listed with Telugu audio. The source is the public release table at [OTTReleaseMovies](https://ottreleasemovies.com/). The catalog sorts by the website's **OTT release date**, newest first.

## Install

Open https://josemsd7.github.io/telugu-dub-catalog/ and click **Install in Stremio**. The existing manifest URL remains:

```text
https://josemsd7.github.io/telugu-dub-catalog/manifest.json
```

The manifest exposes only a movie catalog. No playback, provider credentials, debrid service, paid API or subscription is required for this add-on.

## Automatic updates

GitHub Actions fetches the release page every six hours and publishes the generated JSON and poster images through GitHub Pages. Install once; no manual list syncing is needed. Scheduled jobs can be delayed. A source-wide failure stops publication and keeps the previous deployment available.

- [Freshness, platform counts and source limits](https://josemsd7.github.io/telugu-dub-catalog/status.json)
- [Included titles, OTT dates and excluded rows](https://josemsd7.github.io/telugu-dub-catalog/coverage.json)
- [Workflow runs](https://github.com/josemsd7/telugu-dub-catalog/actions/workflows/catalog.yml)

## What gets included

1. Read factual fields from the publisher's main release table: title, listed OTT date, platform, language/dubbing label, cast and source link. Article prose and platform artwork are not republished.
2. Exclude future or tentative dates, subtitle-only listings, series, reality shows and explicit Telugu originals.
3. Match the film to Cinemeta using title or supplied aliases, cast, country and year. Require confirmed Indian origin. Ambiguous or inconsistent identities are excluded.
4. Use Wikidata original-language metadata when available. Otherwise the publisher must explicitly identify a non-Telugu original language, such as `Tamil to Telugu`. Unknown or conflicting originals stay excluded. Any confirmed Telugu original language causes exclusion, including bilingual Telugu originals.
5. Order by the publisher's OTT date. A film's older cinema release date no longer moves it out of its new Telugu OTT release position. Source display names are preserved while IMDb IDs identify the matched films.
6. Download working poster images and serve them from this add-on's own HTTPS host. Images must be under 100 kB. Alternate sources are attempted when a URL fails. A clearly marked PNG placeholder is used only when a particular film has no available image; such cases are reported in status. A total image-source outage stops deployment.

## Coverage limits

This is an editorial-source catalog, not a direct audit of every streaming platform. OTT dates and Telugu audio are **reported by OTTReleaseMovies**. The add-on does not inspect video audio tracks, require a subscription, or verify availability in the viewer's country. A platform release date is not necessarily the first-ever Telugu digital premiere.

Only the source page's dated rows can be discovered. Missing or ambiguous identities and original languages can exclude valid dubs; `coverage.json` shows the excluded titles and reasons. A Telugu-only or generic multilingual label does not establish whether a film was originally Telugu. Such rows need independent original-language evidence. Titles not yet present in Cinemeta can also be omitted until a later update.

The scraper expects the publisher's release-table headers. A future layout change may require a code update. This setup automates normal refreshes; it is not a promise of complete coverage or zero future maintenance.

## Run locally

Requires Node.js 22+ and Python 3 (standard library only). No npm packages or API keys are needed.

```sh
npm start
```

Use the printed manifest URL in Stremio desktop on the same computer. The process binds to `127.0.0.1`; it must stay running for local use. Phone and TV devices should use hosted HTTPS.

```sh
npm test
npm run verify
npm run build
```

For a local static build, set `ADDON_BASE_URL` to the directory URL where the generated `public/` files will be served. GitHub Actions derives that URL from the repository name automatically.

## Host another copy

GitHub Pages on the free plan requires a public repository. Publishing exposes the add-on code and factual catalog, not personal account details or playback links.

1. Copy this repository into a public repository under your account.
2. Set **Settings → Pages → Source → GitHub Actions**.
3. Enable Actions and allow the workflow to write repository contents.
4. Run **Update and publish catalog** once. Later refreshes are scheduled automatically.

The workflow stores updated factual metadata and caches in `data/catalog.json`. Successful movie searches and film identity checks are cached for seven days; unsuccessful searches and missing original-language identities are retried after six hours. Failed network requests are retried on a subsequent run. A parser failure, empty verified catalog, or total poster outage preserves the previous Pages deployment.

## Sources and code

- Release discovery, Telugu dubbing labels, platform and OTT dates: https://ottreleasemovies.com/
- Film IDs, cast, country and poster metadata: https://v3-cinemeta.strem.io/
- Original-language and country metadata: https://www.wikidata.org/
- Stremio catalog protocol: https://stremio.github.io/stremio-addon-sdk/api/requests/defineCatalogHandler.html

The add-on code is MIT licensed. Third-party metadata and artwork retain their respective ownership and terms. Source links are provided for factual release listings. This project does not claim endorsement by the publisher or streaming platforms.
