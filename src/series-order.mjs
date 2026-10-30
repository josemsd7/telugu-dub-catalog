import {releaseDate} from './identity.mjs';
export const SERIES_DATE_POLICY='first_season_release_desc';
export const seriesReleaseDate=show=>releaseDate(show.firstSeasonReleaseDate)?.slice(0,10)||releaseDate(show.released)?.slice(0,10)||`${String(show.firstSeasonReleaseYear||show.releaseInfo||'').match(/\d{4}/)?.[0]||'0000'}-01-01`;
export function newestSeriesFirst(items){return [...items].sort((a,b)=>seriesReleaseDate(b).localeCompare(seriesReleaseDate(a))||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));}

