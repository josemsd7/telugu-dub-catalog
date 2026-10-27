export const latestSeriesDate=show=>show.latestAiredDate||show.ottReleaseDate||'0000-01-01';
export function newestSeriesFirst(items){return [...items].sort((a,b)=>latestSeriesDate(b).localeCompare(latestSeriesDate(a))||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));}
