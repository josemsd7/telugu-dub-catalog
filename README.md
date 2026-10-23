# Telugu Dubs — Digital Catalog

A catalog-only Stremio add-on for Indian films indexed with Telugu audio, excluding films whose original language includes Telugu. No streaming provider, debrid, TMDB key, MediaFusion account, or payment is required.

**The add-on is live.** The first hosted refresh on 23 October 2026 returned **74 matching films from 565 candidates**, excluding 109 Telugu originals. Counts change as the upstream catalogs change.

## Install in Stremio

Open https://josemsd7.github.io/telugu-dub-catalog/ and click **Install in Stremio**, then confirm installation in Stremio.

Alternatively, paste this manifest URL into Stremio's add-on URL box:

```text
https://josemsd7.github.io/telugu-dub-catalog/manifest.json
```

Automatic updates are scheduled every six hours. No manual list syncing or reinstallation is needed. Check https://josemsd7.github.io/telugu-dub-catalog/status.json for the latest successful refresh and coverage limits. GitHub can delay scheduled runs.

## What it verifies

1. Read the public MediaFusion `telugu_hdrip` and `telugu_dubbed` movie catalog endpoints. No stream endpoints are requested.
2. Match each IMDb ID to Wikidata. Require an Indian country of origin and a known original language. Exclude any film with Telugu as an original language, missing language, conflicting identity, or mismatched title.
3. Independently match country, title, available TMDB identifier, and year against Cinemeta. Unconfirmed films stay out.
4. Expose only Stremio's `catalog` resource. Film details resolve through the user's normal IMDb-compatible metadata add-on.

**Coverage limits:** Telugu audio is reported by the release index; it has not been measured from video tracks. The source does not supply exact Telugu OTT premiere dates. Order uses the film's release date, descending, with release year as fallback when the date is missing. These are not verified Telugu OTT premiere dates. Older films follow newer films. Metadata can contain errors, and strict checks omit some valid dubs. This does not claim a complete list of every Telugu digital release or regional streaming availability.

## Sorting and posters

The catalog sorts by Cinemeta's film release date, newest first. Missing dates fall back to the film release year; these are not Telugu OTT premiere dates. Source re-indexing no longer moves old films above newer releases.

Each hosted build checks poster images and copies valid images to the add-on's own HTTPS host. Images must be under 100 kB. A failed URL is retried using alternate sources. If no image is available for a particular film, a clearly marked PNG placeholder is used and reported in `status.json`. A total poster-source outage stops the deployment and preserves the previous version.

## Free hosting with one GitHub account

The included GitHub Actions workflow refreshes the metadata every six hours and publishes JSON through GitHub Pages. Your computer can stay off. GitHub may delay scheduled jobs; this is automatic periodic refresh, not a fresh upstream scan every time you open Stremio.

**This repository and its hosted movie catalog are public.** The add-on contains no user account details or playback links. The following steps describe how to set up another copy.

1. Create a free account at https://github.com/signup if needed.
2. Create a **public** repository named `telugu-dub-catalog`, default branch `main`.
3. Upload the contents of this extracted folder, including `.github/workflows/catalog.yml`, `src/`, and `data/catalog.json`. Do not upload `data/token.txt` if local use has created it. A GitHub plugin connection can let an assistant help with this after publication is authorized.
4. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Under **Settings → Actions → General**, ensure GitHub Actions is enabled and the workflow may write repository contents.
5. Open **Actions → Update and publish catalog → Run workflow**. When it completes, open the Pages URL shown by the deployment. The page provides **Install in Stremio** and the exact manifest URL.
6. Install once. Subsequent successful scheduled runs update the same URL without syncing or reinstalling. Check `status.json` for freshness. If a run fails, the previous Pages deployment stays available.

Example URL shape only: `https://YOUR-USERNAME.github.io/telugu-dub-catalog/manifest.json`. This placeholder is not an installable hosted add-on.

Regular commits store the refreshed data as part of building the catalog. No fake keepalive action is used. If failures leave the repository inactive for 60 days, GitHub can disable its schedule; re-enable it under Actions after fixing the source failure.

## Use locally now

Requires Node.js 22 or newer and Stremio desktop on the same computer.

```sh
npm start
```

Copy the printed **Manifest** URL into Stremio's add-on URL box. The supplied live snapshot loads immediately. The server refreshes at startup if stale and every six hours while running. This mode needs your computer and this process to remain on. It binds only to `127.0.0.1`; phone/TV devices need hosted HTTPS.

The local manifest also offers title search and original-language filters. The GitHub Pages version offers browse and pagination only.

## Verify or change coverage

```sh
npm test
npm run verify
npm run export
```

`validation-live.json` records counts, exclusions, examples, errors, and duration from the live check. `public/` contains the static Stremio endpoint files after export.

Default coverage is three 100-item pages from each of two source catalogs. Set `SOURCE_PAGES` between 1 and 6 to change coverage. This increases metadata calls and is not a guarantee of completeness. Known identities are cached for seven days; missing identities are retried after six hours. A single independent film check failure excludes that film pending retry; a source-wide failure stops the refresh and preserves the previous successful snapshot/deployment.

## Primary references

- Public source endpoints: https://mediafusion.elfhosted.com/catalog/movie/telugu_hdrip.json and https://mediafusion.elfhosted.com/catalog/movie/telugu_dubbed.json
- MediaFusion: https://github.com/mhdzumair/MediaFusion
- Wikidata original-language property: https://www.wikidata.org/wiki/Property:P364
- Stremio catalog protocol: https://stremio.github.io/stremio-addon-sdk/api/requests/defineCatalogHandler.html
- Stremio's static add-on example: https://github.com/Stremio/stremio-static-addon-example
- GitHub Pages on GitHub Free: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- GitHub schedule limits: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

The add-on code is MIT licensed. Wikidata structured data is CC0. Third-party services and poster URLs retain their own terms. Only factual metadata is retained; MediaFusion descriptions and playback links are not copied.
