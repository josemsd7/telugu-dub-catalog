import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {VERSION,LANGUAGES,normalize,parallelMap,wikiQuery,wikiRecords,releaseDate,newestFirst} from './identity.mjs';
import {parseSource,titleScore,assessFilm,languageHint} from './source-refresh.mjs';
import {discoverSources,SOURCES} from './discovery.mjs';
import {discover91,NINETYONE} from './ninetyone.mjs';
import {newestSeriesFirst} from './series-order.mjs';
import {enrichProviderRows} from './provider-facts.mjs';
import {indiaDate,RELEASE_TIME_ZONE} from './release-time.mjs';

export const SERIES_SOURCES=[...SOURCES.filter(x=>x.key!=='sacnilk'),{key:'sacnilk-series',name:'Sacnilk',url:'https://www.sacnilk.com/entertainmenttopbar/Recent_WebSeries'},NINETYONE];
export async function discoverSeriesSources(previous,options){
  const tableSources=SERIES_SOURCES.filter(x=>x.key!=='91mobiles');
  const results=await Promise.allSettled([discoverSources(previous,{...options,parsePage:parseSource,sources:tableSources,maxPages:150,allowCachedOnly:true}),discover91(previous,options)]);
  const old=results[0].status==='fulfilled'?results[0].value:{rows:[],snapshots:{},statuses:tableSources.map(x=>({...x,state:'unavailable',error:String(results[0].reason?.message||results[0].reason)}))};
  const extra=results[1].status==='fulfilled'?results[1].value:{fresh:false,rows:[],cache:previous.ninetyOneDetailCache,status:{...NINETYONE,state:'unavailable',error:String(results[1].reason?.message||results[1].reason)}};
  if(!old.freshSourceCount&&!extra.fresh)throw new Error('All series release sources failed; preserving the last successful catalog');
  return {...old,rows:[...old.rows,...extra.rows],snapshots:{...old.snapshots,...(extra.snapshot?{[NINETYONE.key]:extra.snapshot}:{})},ninetyOneDetailCache:extra.cache,statuses:[...old.statuses,extra.status,{key:'svteluguott',name:'SV Telugu OTT',url:'https://svteluguott.in/ott-movies',state:'disabled',rowCount:0,error:'The exact public page returned HTTP 403 in the browser on 2026-10-27, before the Series tab could load. No verified live adapter is enabled.'}],windowStart:indiaDate((options.now||Date.now())-365*86400000)};
}
const WEEK=7*86400000,SIX_HOURS=6*3600000;
const fresh=(x,now,ttl=WEEK)=>x?.checkedAt&&now-Date.parse(x.checkedAt)<ttl;
const year=x=>String(x||'').match(/\d{4}/)?.[0]||null;
export const seriesSeason=row=>row.season||Number(String(row.title).match(/\b(?:season\s*|s)(\d+)\b/i)?.[1])||null;
export const cleanSeriesTitle=value=>String(value||'').replace(/\b(?:season\s*\d+(?:\s*part\s*\d+)?|s\d+|\d+\s*[-–]?\s*episodes?|web\s*series|series)\b/gi,' ').replace(/\(\s*\)/g,' ').replace(/\(telugu(?:\s+dub(?:bed)?)?\)/gi,' ').replace(/\s+Telugu$/i,'').replace(/\s*[:–-]\s*$/,'').replace(/\s+/g,' ').trim();
const sourceTitle=row=>({...row,title:cleanSeriesTitle(row.title)});
export function seriesSourceReason(row,today){
  const titledSeason=Number(String(row.title).match(/\b(?:season\s*|s)(\d+)\b/i)?.[1]);
  if(row.season&&titledSeason&&row.season!==titledSeason)return 'conflicting_season';
  if(!row.ottReleaseDate)return 'missing_ott_date';
  if(row.tentative||/[~?]/.test(row.dateText||'')||/[~?]/.test(row.languageText||''))return 'tentative';
  if(row.ottReleaseDate>today)return 'upcoming';
  if(!/\b(series|season|s\d+|episodes?|reality|sitcom|show|television)\b/i.test(row.title+' '+row.genreText))return 'not_a_series';
  if(!/\btelugu\b/i.test(row.languageText))return 'telugu_audio_not_listed';
  if(/subtitles?/i.test(row.languageText))return 'subtitles_not_audio';
  if(/direct\s*telugu|telugu\s*original/i.test(row.languageText))return 'original_telugu';
  if(/\b(korean?|koria|chinese|mandarin|japanese|spanish|french|turkish|arabic|german)\b/i.test(row.languageText))return 'non_indian_language';
  return null;
}
export function parseSeriesFacts(html,id){
  if(!/^\d+$/.test(String(id)))throw new Error('Invalid TMDB series ID');
  const result=spawnSync('python3',[fileURLToPath(new URL('./tmdb_parser.py',import.meta.url)),'tv'],{input:html,encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw new Error('Public series page lacks unambiguous original-language facts');
  const facts=JSON.parse(result.stdout),u=new URL(facts.canonical);
  if(u.origin!=='https://www.themoviedb.org'||u.search||u.hash||u.pathname.match(/^\/tv\/(\d+)(?:-[^/]+)?\/?$/)?.[1]!==String(id))throw new Error('Original-language series ID mismatch');
  const ids=Object.fromEntries(Object.entries({...LANGUAGES,Q8097:'Telugu'}).map(([k,v])=>[v.toLowerCase(),k]));
  const language=ids[facts.originalLanguage.toLowerCase()];if(!language)throw new Error('Unrecognized original language');
  let poster;
  try{const image=new URL(facts.structured?.image);if(image.origin==='https://image.tmdb.org'&&/^\/t\/p\/(?:original|w\d+)\/[^/]+$/.test(image.pathname))poster=image.href.replace(/\/t\/p\/[^/]+\//,'/t/p/w342/');}catch{}
  return {title:facts.title,languageIds:[language],countries:(facts.structured?.countries||[]).map(x=>x.toLowerCase()),sourceUrl:`https://www.themoviedb.org/tv/${id}`,poster,checkedAt:null};
}
async function get(url,fetcher){
  const r=await fetcher(url,{headers:{Accept:'application/json,text/html;q=0.9','User-Agent':'TeluguDubCatalog/0.5 (factual metadata; https://github.com/josemsd7/telugu-dub-catalog)'},signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new Error(`Metadata HTTP ${r.status}`);return r;
}
function compactMeta(m,checkedAt,today){
  const seasonLatestDates={};
  for(const v of m.videos||[]){const day=indiaDate(v.released);if(v.season>0&&day&&Date.parse(v.released)<=Date.parse(checkedAt)&&(!seasonLatestDates[v.season]||day>seasonLatestDates[v.season]))seasonLatestDates[v.season]=day;}
  return {id:m.id,name:m.name,type:m.type,countries:String(m.country||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),year:year(m.releaseInfo||m.year||m.released),releaseInfo:m.releaseInfo||m.year,released:releaseDate(m.released),poster:m.poster,tmdbId:m.moviedb_id?String(m.moviedb_id):null,cast:(m.cast||[]).slice(0,30),directors:[],schemaVersion:3,seasonLatestDates,seasons:[...new Set((m.videos||[]).filter(v=>v.season>0&&v.released&&indiaDate(v.released)<=today).map(v=>v.season))],checkedAt};
}
export function assessSeries(row,match,identity,facts){
  const result=assessFilm(sourceTitle(row),match,identity,facts);
  if(!result.reason&&result.originalLanguages.includes('Q1860')&&!identity?.languages?.includes('Q1860')&&languageHint(row)!=='Q1860')return {reason:'english_original_uncorroborated'};
  return result;
}
export function mergeSeriesListings(items){
  const byId=new Map();
  for(const item of items){
    const old=byId.get(item.id);
    if(old)old.releaseListings.push(...item.releaseListings);else byId.set(item.id,structuredClone(item));
  }
  for(const show of byId.values()){
    show.releaseListings=[...new Map(show.releaseListings.map(x=>[JSON.stringify(x),x])).values()];
    show.platforms=[...new Set(show.releaseListings.flatMap(x=>x.platforms))];
    show.sourceNames=[...new Set(show.releaseListings.map(x=>x.sourceName))];
    // Same-season/platform duplicates use the earliest reported date. A later
    // listed season can move an existing series up, without creating duplicates.
    const groups=new Map();
    for(const listing of show.releaseListings){const key=listing.season||'unspecified';const dates=groups.get(key)||[];dates.push(listing.ottReleaseDate);groups.set(key,dates);}
    show.ottReleaseDate=[...groups.values()].map(x=>x.sort()[0]).sort().at(-1);
    show.latestAiredDate=[show.ottReleaseDate,...show.releaseListings.map(x=>x.lastAiredDate).filter(Boolean)].sort().at(-1);
    show.reportedSeasons=[...new Set(show.releaseListings.map(x=>x.season).filter(Boolean))].sort((a,b)=>a-b);
    show.releaseDateConflicts=[...groups].filter(([,dates])=>new Set(dates).size>1).map(([season,dates])=>({season,dates:[...new Set(dates)].sort()}));
    const listingText=show.reportedSeasons.length?` Reported seasons: ${show.reportedSeasons.join(', ')}.`:'';
    show.description=`Latest aired episode or Telugu release: ${show.latestAiredDate}. Latest listed Telugu season release: ${show.ottReleaseDate}. Platforms: ${show.platforms.join(', ')||'not specified'}. Original language: ${show.genres.join(', ')}.${listingText} Telugu audio is reported by ${show.sourceNames.join(', ')} for the listed releases; this does not confirm every season or episode. Audio tracks and regional availability are not independently inspected.`;
    show.links=[...new Map(show.releaseListings.map(x=>[x.sourceUrl,{name:x.sourceName,category:'Telugu release source',url:x.sourceUrl}])).values(),...(show.originalLanguageSourceUrl?[{name:'Original language',category:'Source',url:show.originalLanguageSourceUrl}]:[])];
    for(const url of new Set(show.releaseListings.map(x=>x.airDateSource).filter(Boolean)))if(!show.links.some(x=>x.url===url))show.links.push({name:'Episode air date',category:'Air date source',url});
  }
  return newestSeriesFirst([...byId.values()]);
}
export async function refreshSeries(previous={},options={}){
  const fetcher=options.fetcher||fetch,now=options.now||Date.now(),checkedAt=new Date(now).toISOString(),today=indiaDate(now),progress=options.onProgress||(()=>{});
  const source=options.source||await discoverSeriesSources(previous,{fetcher,now,onProgress:progress});
  const counts={},audit=[],warnings=[];
  const reject=(row,reason)=>{counts[reason]=(counts[reason]||0)+1;audit.push({title:row.title,ottReleaseDate:row.ottReleaseDate,season:seriesSeason(row),sourceName:row.sourceName,sourceUrl:row.sourceUrl,reason});};
  let eligible=[];
  for(const row of source.rows){const reason=seriesSourceReason(row,today);if(reason)reject(row,reason);else eligible.push(row);}
  // Carry available cast/host evidence across name-only cards for the same show.
  // A regional adaptation must not inherit the ID of a different-language host.
  const castEvidence=new Map();
  for(const row of source.rows){if(!row.castText||! /\b(series|season|episodes?|reality|sitcom|show)\b/i.test(row.title+' '+row.genreText))continue;const key=normalize(cleanSeriesTitle(row.title)),items=castEvidence.get(key)||[];items.push(row);castEvidence.set(key,items);}
  for(let i=0;i<eligible.length;i++){const row=eligible[i],evidence=castEvidence.get(normalize(cleanSeriesTitle(row.title)))||[];if(!row.castText&&evidence.length)eligible[i]={...row,castText:evidence.map(x=>x.castText).join(', '),castEvidenceUrls:[...new Set(evidence.map(x=>x.sourceUrl))]};}
  const providerEvidence=await enrichProviderRows(eligible,previous.providerFactsCache,{fetcher,now,type:'TVSeries',titleScore:(a,b)=>titleScore(cleanSeriesTitle(a),b)});
  eligible=providerEvidence.rows;warnings.push(...providerEvidence.warnings);
  progress(`Series: ${source.rows.length} source rows; ${eligible.length} candidates`);
  const searches={...(previous.searchCache||{})},metas={...(previous.metadataCache||{})},identities={...(previous.identities||{})},originals={...(previous.originalLanguageCache||{})};
  const searchPromises=new Map(),metaPromises=new Map();
  async function search(row){
    const title=cleanSeriesTitle(row.title),key=normalize(title),cached=searches[key];
    if(fresh(cached,now,cached?.hits.length?WEEK:SIX_HOURS))return cached.hits;
    if(!searchPromises.has(key))searchPromises.set(key,(async()=>{
      let hits=[];
      for(const query of [...new Set([title,title.replace(/\([^)]*\)/g,' ').trim()])]){
        const result=await (await get(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(query)}.json`,fetcher)).json();
        if(!Array.isArray(result.metas))throw new Error('Invalid series search response');
        hits=result.metas.filter(x=>x.type==='series'&&/^tt\d+$/.test(x.id)&&titleScore(title,x.name)>0).slice(0,4).map(x=>({id:x.id,name:x.name}));if(hits.length)break;
      }
      searches[key]={hits,checkedAt};return hits;
    })());return searchPromises.get(key);
  }
  async function meta(hit){
    if(metas[hit.id]?.schemaVersion===3&&fresh(metas[hit.id],now,SIX_HOURS))return metas[hit.id];
    if(!metaPromises.has(hit.id))metaPromises.set(hit.id,(async()=>{
      const d=await (await get(`https://v3-cinemeta.strem.io/meta/series/${hit.id}.json`,fetcher)).json();
      if(d.meta?.id!==hit.id||d.meta.type!=='series')throw new Error('Invalid series identity');
      metas[hit.id]=compactMeta(d.meta,checkedAt,today);return metas[hit.id];
    })());return metaPromises.get(hit.id);
  }
  let done=0;
  const resolved=(await parallelMap(eligible,4,async row=>{
    try{
      const matches=[];let seasonRejected=false;
      for(const hit of await search(row)){
        const m=await meta(hit);if(m.year&&m.year>row.ottReleaseDate.slice(0,4))continue;
        if(m.countries.length&&!m.countries.includes('india'))continue;
        const season=seriesSeason(row);if(season&&!m.seasons.includes(season)){seasonRejected=true;continue;}
        const cast=normalize(row.castText),castMatches=m.cast.filter(x=>normalize(x).length>=4&&cast.includes(normalize(x))).length;
        const score=titleScore(cleanSeriesTitle(row.title),m.name);matches.push({row,meta:m,titleScore:score,castMatches,score:score+15*Math.min(4,castMatches)});
      }
      matches.sort((a,b)=>b.score-a.score);
      if(!matches.length){reject(row,seasonRejected?'season_unconfirmed':'no_matching_series_id');return null;}
      if(matches[1]?.score===matches[0].score){reject(row,'ambiguous_series_match');return null;}
      return matches[0];
    }catch(e){warnings.push(`${row.title}: ${e.message}`);reject(row,'series_lookup_failed');return null;}
    finally{if(++done%20===0)progress(`Series identities: ${done}/${eligible.length}`);}
  })).filter(Boolean);
  const ids=[...new Set(resolved.map(x=>x.meta.id))],pending=ids.filter(id=>!fresh(identities[id],now,identities[id]?.languages.length?WEEK:SIX_HOURS));
  const batches=[];for(let i=0;i<pending.length;i+=60)batches.push(pending.slice(i,i+60));
  await parallelMap(batches,2,async batch=>{
    try{
      const query=wikiQuery(batch).replace('wdt:P4947','wdt:P4983');
      const r=await (await get('https://query.wikidata.org/sparql?'+new URLSearchParams({query,format:'json'}),fetcher)).json();
      if(!Array.isArray(r.results?.bindings))throw new Error('Invalid Wikidata response');
      const records=wikiRecords(r.results.bindings,checkedAt);
      for(const id of batch)identities[id]=records[id]||{items:[],languages:[],countries:[],tmdbIds:[],checkedAt};
    }catch(e){warnings.push('Series original-language lookup: '+e.message);}
  });
  const needed=new Map();
  for(const m of resolved){
    const identity=identities[m.meta.id],reason=assessFilm(sourceTitle(m.row),m,identity).reason;
    if((!identity?.languages.length||!m.meta.countries.includes('india')&&!identity?.countries.includes('Q668'))&&/^\d+$/.test(m.meta.tmdbId||'')&&[null,'indian_origin_unconfirmed','original_language_unconfirmed'].includes(reason))needed.set(m.meta.tmdbId,m);
  }
  await parallelMap([...needed.keys()],2,async id=>{
    try{if(fresh(originals[id],now))return;originals[id]={...parseSeriesFacts(await (await get(`https://www.themoviedb.org/tv/${id}?language=en-US`,fetcher)).text(),id),checkedAt};}
    catch(e){warnings.push(`TMDB series ${id}: ${e.message}`);}
  });
  const accepted=[];
  for(const match of resolved){
    const {row,meta:m}=match,a=assessSeries(row,match,identities[m.id],originals[m.tmdbId]);
    if(a.reason){reject(row,a.reason.replace('film','series'));continue;}
    const season=seriesSeason(row);
    // Air dates are factual schedule data, separate from the source proving
    // Telugu audio. Borrow them only for the same matched show and listed season.
    const airing=season?source.rows.filter(x=>x.sourceKey==='91mobiles'&&x.season===season&&x.lastAiredDate&&x.lastAiredDate<=today&&titleScore(cleanSeriesTitle(x.title),m.name)>0&&(!x.castText||m.cast.some(name=>normalize(name).length>=4&&normalize(x.castText).includes(normalize(name))))).sort((a,b)=>b.lastAiredDate.localeCompare(a.lastAiredDate))[0]:null;
    const lastAiredDate=[row.ottReleaseDate,row.lastAiredDate,airing?.lastAiredDate,season?m.seasonLatestDates?.[season]:null].filter(x=>x&&x<=today).sort().at(-1);
    const originalEvidence=a.originalEvidence==='Publisher explicit dubbing-direction label'&&row.publisherLanguageEvidence?row.publisherLanguageEvidence:a.originalEvidence;
    const originalSourceUrl=a.originalSourceUrl||(originalEvidence===row.publisherLanguageEvidence?row.sourceUrl:undefined);
    accepted.push({id:m.id,type:'series',name:m.name,releaseInfo:m.releaseInfo||m.year,released:m.released||undefined,genres:a.originalLanguages.map(x=>LANGUAGES[x]||'Other'),poster:m.poster,posterCandidates:[...new Set([m.poster,`https://images.metahub.space/poster/small/${m.id}/img`,originals[m.tmdbId]?.poster].filter(Boolean))],originalLanguageIds:a.originalLanguages,originalLanguageEvidence:originalEvidence,originalLanguageSourceUrl:originalSourceUrl,countryEvidence:a.countryEvidence,countrySourceUrl:a.countrySourceUrl,releaseListings:[{sourceName:row.sourceName||'OTTReleaseMovies',sourceUrl:row.sourceUrl,title:row.title,ottReleaseDate:row.ottReleaseDate,platforms:row.platforms,season,lastAiredDate,latestEpisode:airing?.lastAiredDate===lastAiredDate?airing.latestEpisode:row.latestEpisode||null,airDateSource:airing?.lastAiredDate===lastAiredDate?airing.sourceUrl:row.lastAiredDate&&row.lastAiredDate===lastAiredDate?row.sourceUrl:season&&m.seasonLatestDates?.[season]===lastAiredDate?`https://v3-cinemeta.strem.io/meta/series/${m.id}.json`:row.sourceUrl,audioEvidence:row.audioEvidence||'Publisher Telugu release listing'}]});
  }
  const series=mergeSeriesListings(accepted);
  if(!series.length)throw new Error('No verified series; preserving the last successful series catalog');
  progress(`Verified ${series.length} series and TV shows`);
  return {version:VERSION,checkedAt,releaseTimeZone:RELEASE_TIME_ZONE,series,providerFactsCache:providerEvidence.cache,sourceName:'OTTReleaseMovies + Trendraja + Sacnilk + 123telugu + 91mobiles series',sourceUrls:SERIES_SOURCES.map(x=>x.url),sourceRowCount:source.rows.length,candidateCount:eligible.length,sourceStatus:source.statuses||[],sourceSnapshots:source.snapshots||{},ninetyOneDetailCache:source.ninetyOneDetailCache||previous.ninetyOneDetailCache||{},datePolicy:'latest_aired_confirmed_season_then_telugu_release',coverageWindowStart:source.windowStart,coverageHistoryDays:365,acceptedListingCount:accepted.length,duplicatesMerged:accepted.length-series.length,counts,audit,refreshWarnings:warnings,searchCache:searches,metadataCache:metas,identities,originalLanguageCache:originals,limits:['Indian series and TV shows reported with Telugu audio; Telugu originals are excluded, matching the movie catalog scope.','Rolling 365 days of source-listed releases; coverage depends on publishers and verified series identities.','Reported audio applies to listed releases/seasons, not necessarily every episode. Regional availability and actual audio tracks are not inspected.','One entry per IMDb series ID. Order is the latest past episode date within a source-confirmed Telugu season, or the Telugu release date if later. Unspecified seasons use only the listed Telugu release date. Future episodes and unlisted seasons cannot promote a show.','Unmatched titles, unconfirmed seasons, uncertain original languages and conflicting identities remain excluded. An English-original field on a public TMDB page needs publisher or Wikidata corroboration for Indian series; English defaults conflicted with Telugu originals during validation.','91mobiles requires an explicit [Telugu] streaming-offer label; presence on its Telugu category page alone is insufficient. Original-language and India-origin checks remain required. SV Telugu OTT returned HTTP 403 in this browser during validation and contributes no rows.','If all sources fail or no series are verified, the previous series data is preserved.']};
}

