import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {catalog,manifest,status} from './src/core.mjs';

export async function exportStatic(data,destination=new URL('./public/',import.meta.url)) {
  if(!data.movies?.length)throw new Error('Refusing to export an empty catalog');
  await rm(destination,{recursive:true,force:true});
  const route=new URL('catalog/movie/telugu-dubbed/',destination);
  await mkdir(route,{recursive:true});
  const save=(name,body)=>writeFile(new URL(name,destination),JSON.stringify(body));
  const info=manifest();
  // Static hosting supports browse and pagination. Do not advertise dynamic search.
  info.catalogs[0].extra=[{name:'skip'}];
  await save('manifest.json',info);
  const {stale,...snapshotStatus}=status(data);
  await save('status.json',{...snapshotStatus,staleAfter:new Date(Date.parse(data.checkedAt)+6*3600000).toISOString()});
  await save('coverage.json',{checkedAt:data.checkedAt,sourceUrl:data.sourceUrl,sourceUrls:data.sourceUrls,coverageWindowStart:data.coverageWindowStart,datePolicy:data.datePolicy,sources:data.sourceStatus,accepted:data.movies.map(x=>({id:x.id,name:x.name,sourceTitle:x.sourceTitle,ottReleaseDate:x.ottReleaseDate,platforms:x.platforms,originalLanguages:x.genres,originalLanguageEvidence:x.originalLanguageEvidence,originalLanguageSourceUrl:x.originalLanguageSourceUrl,sourceUrl:x.sourceUrl,sourceNames:x.sourceNames,releaseListings:x.releaseListings,releaseDateConflicts:x.releaseDateConflicts,countryEvidence:x.countryEvidence,countrySourceUrl:x.countrySourceUrl})),excluded:data.audit||[]});
  await save('catalog/movie/telugu-dubbed.json',catalog(data));
  for(let skip=0;skip<=Math.ceil(data.movies.length/100)*100;skip+=100)
    await save(`catalog/movie/telugu-dubbed/skip=${skip}.json`,catalog(data,`skip=${skip}`));
  await writeFile(new URL('.nojekyll',destination),'');
  await writeFile(new URL('index.html',destination),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Telugu Dubs — Latest OTT</title><style>body{font:18px/1.6 system-ui;max-width:700px;margin:4rem auto;padding:0 1.5rem;color:#17242b}button{font:inherit;padding:.7rem 1rem}input{width:95%;padding:.5rem;font:14px monospace}small{display:block;margin:1rem 0;color:#52636b}</style><h1>Telugu Dubs — Latest OTT</h1><p>${data.movies.length} Indian films listed with Telugu audio by OTTReleaseMovies, Trendraja and Sacnilk. Films listed as originally Telugu are excluded.</p><p><b>Order: earliest reported Telugu OTT date, newest first.</b> Combines the past 365 days of release listings. Duplicate films are merged; differing dates remain visible in the coverage report. Dates and Telugu audio are reported by the source websites. Tentative dates and unconfirmed original languages are excluded; audio tracks and regional subscriptions are not inspected.</p><p>Metadata checked: ${data.checkedAt}. Automatic updates are scheduled every six hours; jobs can be delayed.</p><button id="install">Install in Stremio</button><p><input id="link" readonly aria-label="Stremio manifest URL"></p><small>Catalog only. No playback, provider login, debrid, or API key. Sources: <a href="https://ottreleasemovies.com/">OTTReleaseMovies</a>, <a href="https://trendraja.in/telugu-movie-ott-release-dates-2021/">Trendraja</a>, <a href="https://www.sacnilk.com/ott-movie-releases">Sacnilk</a>, <a href="https://www.wikidata.org">Wikidata</a>, <a href="https://www.themoviedb.org">TMDB</a>, and <a href="https://v3-cinemeta.strem.io">Cinemeta</a>. <a href="status.json">Freshness and checks</a>. <a href="coverage.json">Included and excluded titles</a>.</small><script>const u=new URL('manifest.json',location.href);document.getElementById('link').value=u.href;document.getElementById('install').onclick=()=>location.href='stremio://'+u.host+u.pathname;</script></html>`);
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const data=JSON.parse(await readFile(new URL('./data/catalog.json',import.meta.url),'utf8'));
  await exportStatic(data);
  console.log(`Exported ${data.movies.length} movies to public/`);
}
