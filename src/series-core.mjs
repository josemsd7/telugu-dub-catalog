import {RELEASE_TIME_ZONE} from './release-time.mjs';
import {normalize,VERSION} from './identity.mjs';
import {newestSeriesFirst} from './series-order.mjs';
export const SERIES_ID='telugu-dubbed-series';
export function seriesCatalog(data,extra=''){
  if(extra.length>2000)throw new Error('Invalid parameters');
  const params=new URLSearchParams(extra.includes('=')?extra:decodeURIComponent(extra)),skip=params.get('skip')||'0';
  if(!/^\d{1,6}$/.test(skip))throw new Error('Invalid skip');
  const search=normalize((params.get('search')||'').slice(0,200)),genre=params.get('genre');
  return {metas:newestSeriesFirst(data.series||[]).filter(x=>x.type==='series'&&(!search||normalize(x.name).includes(search))&&(!genre||x.genres?.includes(genre))).slice(Number(skip),Number(skip)+100).map(x=>({id:x.id,type:'series',name:x.name,poster:x.poster,posterShape:'poster',releaseInfo:x.releaseInfo,description:x.description,genres:x.genres,links:x.links})),cacheMaxAge:600,staleRevalidate:3600};
}
export function seriesStatus(data){
  const platformCounts={};for(const x of data.series||[])for(const p of x.platforms||[])platformCounts[p]=(platformCounts[p]||0)+1;
  return {version:VERSION,releaseTimeZone:data.releaseTimeZone||RELEASE_TIME_ZONE,checkedAt:data.checkedAt||null,verifiedSeriesCount:data.series?.length||0,sources:data.sourceStatus||[],sourceUrls:data.sourceUrls||[],coverageWindowStart:data.coverageWindowStart||null,datePolicy:'latest_aired_confirmed_season_then_telugu_release',candidateCount:data.candidateCount||0,acceptedListingCount:data.acceptedListingCount||0,duplicatesMerged:data.duplicatesMerged||0,platformCounts,exclusions:data.counts||{},refreshWarnings:data.refreshWarnings||[],limits:data.limits||[],lastError:data.lastError||null};
}

