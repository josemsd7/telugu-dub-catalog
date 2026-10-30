import {VERSION,normalize,newestFirst} from './identity.mjs';
import {seriesCatalog,seriesStatus,SERIES_ID} from './series-core.mjs';
export {VERSION,LANGUAGES,normalize,jsonFetch,parallelMap,wikiQuery,wikiRecords,releaseDate,newestFirst} from './identity.mjs';
export {refreshFromOtt as refresh} from './source-refresh.mjs';
const MAX_AGE=6*60*60*1000;

export function manifest() {
  return {id:'private.telugu.dubbed.digital.catalog',version:VERSION,name:'Telugu Dubs — Latest OTT',description:'Catalog only. Indian films and series listed with Telugu audio, combining OTTReleaseMovies, Trendraja, Sacnilk and 123telugu, ordered by earliest reported Telugu OTT dates. Movies and series appear in separate catalogs. Series use 91mobiles alongside the other sources and are ordered by latest aired episode within a listed Telugu season, falling back to Telugu release dates. Telugu originals, tentative releases and unverified identities excluded. Wikidata, TMDB and Cinemeta verify film identities and original languages.',resources:['catalog'],types:['movie','series'],catalogs:[{type:'movie',id:'telugu-dubbed',name:'Available in Telugu',extra:[{name:'skip'},{name:'search'},{name:'genre',options:['Tamil','Hindi','Malayalam','Kannada','English','Bengali','Marathi','Punjabi','Odia','Other']}]},{type:'series',id:SERIES_ID,name:'Available in Telugu — Series & TV',extra:[{name:'skip'}]}],behaviorHints:{configurable:false}};
}

export function catalog(data,extra='') {
  if(extra.length>2000)throw new Error('Invalid extra parameters');
  const params=new URLSearchParams(extra.includes('=')?extra:decodeURIComponent(extra));
  const rawSkip=params.get('skip')||'0';if(!/^\d{1,6}$/.test(rawSkip))throw new Error('Invalid skip');
  const skip=Number(rawSkip),search=normalize((params.get('search')||'').slice(0,200)),genre=params.get('genre');
  const items=newestFirst(data.movies||[]).filter(x=>x.type==='movie'&&(!search||normalize(x.name).includes(search))&&(!genre||x.genres.includes(genre)));
  const metas=items.slice(skip,skip+100).map(({originalLanguageIds,originalLanguageEvidence,originalLanguageSourceUrl,sourceCatalog,wikidata,sourceRank,identityCheckedAt,posterCandidates,ottReleaseDate,platforms,sourceTitle,sourceUrl,canonicalName,sourceNames,releaseListings,releaseDateConflicts,countryEvidence,countrySourceUrl,...meta})=>meta);
  return {metas,cacheMaxAge:600,staleRevalidate:3600};
}

export function status(data) {
  const platformCounts={};for(const movie of data.movies||[])for(const name of movie.platforms||[])platformCounts[name]=(platformCounts[name]||0)+1;
  return {version:VERSION,sourceName:data.sourceName||null,sourceUrl:data.sourceUrl||null,sortOrder:data.sortOrder||null,datePolicy:data.datePolicy||null,coverageWindowStart:data.coverageWindowStart||null,coverageHistoryDays:data.coverageHistoryDays||null,sourceUrls:data.sourceUrls||[],sources:data.sourceStatus||[],acceptedListingCount:data.acceptedListingCount||0,duplicatesMerged:data.duplicatesMerged||0,releaseDateConflictCount:data.releaseDateConflictCount||0,verifiedMovieCount:data.movies?.length||0,checkedAt:data.checkedAt||null,stale:!data.checkedAt||Date.now()-Date.parse(data.checkedAt)>MAX_AGE,sourceRowCount:data.sourceRowCount||0,candidateCount:data.candidateCount||0,platformCounts,exclusions:data.counts||{},limits:data.limits||[],refreshWarnings:data.refreshWarnings||[],lastError:data.lastError||null};
}

export async function handle(request,env,store,context={}) {
  const token=env.ADDON_TOKEN;
  if(!token||!/^[-_a-zA-Z0-9]{24,128}$/.test(token))return new Response('Set a private ADDON_TOKEN (24–128 URL-safe characters).',{status:503});
  const path=new URL(request.url).pathname,prefix='/'+token;
  if(!path.startsWith(prefix+'/'))return new Response('Not found',{status:404,headers:{'X-Robots-Tag':'noindex, nofollow'}});
  const route=path.slice(prefix.length);
  const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Cache-Control':'private, max-age=600'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  if(route==='/manifest.json')return Response.json(manifest(),{headers});
  const data=await store.get()||{};
  if(route==='/status.json')return Response.json(status(data),{headers:{...headers,'Cache-Control':'no-store'}});
  if(route==='/series/status.json')return Response.json(seriesStatus(await store.getSeries?.()||{}),{headers});
  const seriesMatch=route.match(/^\/catalog\/series\/telugu-dubbed-series(?:\/(.*))?\.json$/);
  if(seriesMatch){
    const shows=await store.getSeries?.()||{};
    if(!shows.checkedAt)return Response.json({error:'Initial series refresh has not completed.'},{status:503,headers});
    try{return Response.json(seriesCatalog(shows,seriesMatch[1]||''),{headers});}catch{return Response.json({error:'Invalid catalog parameters'},{status:400,headers});}
  }
  const match=route.match(/^\/catalog\/movie\/telugu-dubbed(?:\/(.*))?\.json$/);
  if(match){
    if(!data.checkedAt)return Response.json({error:'Initial metadata refresh has not completed.'},{status:503,headers});
    try{return Response.json(catalog(data,match[1]||''),{headers});}catch{return Response.json({error:'Invalid catalog parameters'},{status:400,headers});}
  }
  return new Response('Not found',{status:404,headers});
}


