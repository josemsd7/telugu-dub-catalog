import {parallelMap,normalize} from './identity.mjs';

export const SOURCE_URL='https://ottreleasemovies.com/';
export const SOURCE_NAME='OTTReleaseMovies + Trendraja + Sacnilk';
export const SOURCES=[
  {key:'ottreleasemovies',name:'OTTReleaseMovies',url:SOURCE_URL},
  {key:'trendraja',name:'Trendraja',url:'https://trendraja.in/telugu-movie-ott-release-dates-2021/'},
  {key:'sacnilk',name:'Sacnilk',url:'https://www.sacnilk.com/ott-movie-releases'},
];
const UA='TeluguDubCatalog/0.4 (personal factual release metadata; https://github.com/josemsd7/telugu-dub-catalog)';
const DAY=86400000,MAX_PAGES=50;
const rowKey=r=>[normalize(r.title),r.ottReleaseDate||'',...(r.platforms||[]).slice().sort()].join('|');
const unique=rows=>[...new Map(rows.map(r=>[rowKey(r),r])).values()];
export const compactSnapshots=snapshots=>Object.fromEntries(Object.entries(snapshots).map(([key,s])=>[key,{...s,rows:s.rows.map(({sourceName,sourceKey,sourceRank,dateText,audioEvidence,unknownPlatformIcons,...facts})=>facts)}]));

export async function discoverSources(previous={},options={}) {
  const {parsePage}=options,fetcher=options.fetcher||fetch,now=options.now||Date.now();
  const checkedAt=new Date(now).toISOString(),windowStart=new Date(now-365*DAY).toISOString().slice(0,10);
  const recent=rows=>rows.filter(r=>!r.ottReleaseDate||r.ottReleaseDate>=windowStart);
  const snapshots={},statuses=[];let fresh=0;
  async function page(source,url=source.url){
    const response=await fetcher(url,{headers:{Accept:'text/html','User-Agent':UA},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return parsePage(await response.text(),source.key);
  }
  // Sources run sequentially. Sacnilk's public pagination has concurrency two.
  for(const source of options.sources||SOURCES){
    const saved=previous.sourceSnapshots?.[source.key];
    const old=saved?{...saved,rows:saved.rows.map((r,i)=>({...r,sourceKey:source.key,sourceName:source.name,sourceRank:i}))}:null;
    try{
      const first=await page(source);let rows=[...first.rows],pageCount=1,expectedPages=1;
      const errors=[];
      if(source.key==='sacnilk'){
        expectedPages=first.totalPages||1;
        if(expectedPages>MAX_PAGES)throw new Error(`Pagination exceeds verified limit (${MAX_PAGES})`);
        // Cards are newest first. Stop once a full page is older than the window.
        let reachedEnd=first.rows.every(r=>r.ottReleaseDate&&r.ottReleaseDate<windowStart);
        for(let start=2;start<=expectedPages&&!reachedEnd;start+=2){
          const numbers=[start,start+1].filter(n=>n<=expectedPages);
          const results=await parallelMap(numbers,2,async n=>{
            try{return {data:await page(source,source.url+`?page=${n}&time_period=all&type=recent`)};}
            catch(error){return {error:`Page ${n}: ${String(error.message||error)}`};}
          });
          for(const result of results){
            if(result.error){errors.push(result.error);continue;}
            rows.push(...result.data.rows);pageCount++;
            if(result.data.rows.every(r=>r.ottReleaseDate&&r.ottReleaseDate<windowStart))reachedEnd=true;
          }
          if((start-2)%4===0)options.onProgress?.(`Sacnilk: fetched ${pageCount} page(s); ${errors.length} page error(s)`);
        }
      }
      const rawRows=rows.length;
      rows=unique(recent(rows));
      if(errors.length&&old)rows=unique([...recent(old.rows),...rows]);
      rows=rows.map((r,i)=>({...r,sourceKey:source.key,sourceName:source.name,sourceRank:i}));
      snapshots[source.key]={checkedAt,rows,rawRowCount:rawRows};fresh++;
      statuses.push({...source,state:errors.length?'partial':'ok',checkedAt,rowCount:rows.length,rawRowCount:rawRows,pagesFetched:pageCount,pagesAvailable:expectedPages,errors});
      options.onProgress?.(`${source.name}: ${rows.length} recent listings from ${pageCount} page(s)${errors.length?(old?' (partial; cached rows retained)':' (partial)'):''}`);
    }catch(error){
      const cached=old?.rows?.length?{...old,rows:recent(old.rows)}:null;
      if(cached?.rows.length)snapshots[source.key]=cached;
      statuses.push({...source,state:cached?.rows.length?'cached':'unavailable',checkedAt:old?.checkedAt||null,rowCount:cached?.rows.length||0,error:String(error.message||error).slice(0,180)});
      options.onProgress?.(`${source.name}: ${cached?.rows.length?'using last successful snapshot':'unavailable'} (${String(error.message||error)})`);
    }
  }
  if(!fresh)throw new Error('All release sources failed; preserving last successful catalog');
  const rows=Object.values(snapshots).flatMap(s=>s.rows);
  if(!rows.length)throw new Error('Release sources returned no recent rows; preserving last successful catalog');
  statuses.push({key:'svteluguott',name:'SV Telugu OTT',url:'https://svteluguott.in/ott-movies',state:'disabled',rowCount:0,error:'Automated access returned HTTP 403 during validation on 2026-10-23; no verified live adapter is enabled.'});
  return {rows,sourceRowCount:rows.length,snapshots:compactSnapshots(snapshots),statuses,windowStart,historyDays:365};
}
