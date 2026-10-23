export const VERSION = '0.2.0';
export const LANGUAGES = {Q5885:'Tamil',Q1568:'Hindi',Q36236:'Malayalam',Q33673:'Kannada',Q5146:'Punjabi',Q9610:'Bengali',Q1571:'Marathi',Q33810:'Odia',Q1860:'English'};
const UA = 'TeluguDubCatalog/0.1 (personal non-commercial catalog metadata; no playback requests)';
const MAX_AGE = 6 * 60 * 60 * 1000;
export const normalize = value => String(value || '').replace(/\s*\((?:telugu|tamil|hindi|malayalam|kannada)(?:\s+version)?\)\s*/gi,'').replace(/&/g,' and ').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const tail = value => String(value || '').split('/').pop();
const yearOf = value => String(value || '').match(/\d{4}/)?.[0] || null;
const plain = (value,max=300) => String(value || '').slice(0,max);

export async function jsonFetch(url, fetcher=fetch) {
  const response = await fetcher(url, {headers:{Accept:'application/json', 'User-Agent':UA}, signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Metadata source returned HTTP ${response.status}`);
  return response.json();
}

export async function parallelMap(values, concurrency, work) {
  const results = new Array(values.length); let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{
    for (;;) {const i=next++; if(i>=values.length)return;results[i]=await work(values[i],i);}
  })); return results;
}

export function wikiQuery(ids) {
  if (!ids.length || ids.some(id=>!/^tt\d+$/.test(id))) throw new Error('Invalid IMDb identifiers');
  return `SELECT ?item ?itemLabel ?imdb ?lang ?country ?tmdb (MIN(?pub) AS ?date) (GROUP_CONCAT(DISTINCT ?alias; separator="|||") AS ?aliases) WHERE {
 VALUES ?imdb { ${ids.map(id=>'"'+id+'"').join(' ')} }
 ?item wdt:P345 ?imdb.
 OPTIONAL { ?item wdt:P364 ?lang. }
 OPTIONAL { ?item wdt:P495 ?country. }
 OPTIONAL { ?item wdt:P4947 ?tmdb. }
 OPTIONAL { ?item wdt:P577 ?pub. }
 OPTIONAL { ?item skos:altLabel ?alias. FILTER(LANG(?alias)="en") }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?imdb ?lang ?country ?tmdb`;
}

export function wikiRecords(rows, checkedAt) {
  const records={};
  for(const row of rows) {
    const id=row.imdb?.value; if(!/^tt\d+$/.test(id||''))continue;
    const r=records[id] ||= {items:[],names:[],languages:[],countries:[],tmdbIds:[],years:[],checkedAt};
    for(const [key,value] of [['items',tail(row.item?.value)],['names',normalize(row.itemLabel?.value)],['languages',tail(row.lang?.value)],['countries',tail(row.country?.value)],['tmdbIds',row.tmdb?.value],['years',yearOf(row.date?.value)]]) {
      if(value&&!r[key].includes(value))r[key].push(value);
    }
    for(const name of (row.aliases?.value || '').split('|||')) {const n=normalize(name);if(n&&!r.names.includes(n))r.names.push(n);}
  }return records;
}

export function wikiReason(item, r) {
  if(!r||!r.items.length)return 'missing_identity';
  if(r.items.length!==1)return 'ambiguous_identity';
  if(!r.countries.includes('Q668'))return 'not_confirmed_indian';
  if(!r.languages.length)return 'missing_original_language';
  if(r.languages.includes('Q8097'))return 'original_telugu';
  if(!r.names.includes(normalize(item.name)))return 'title_mismatch';
  return null;
}

export function canonicalReason(item, r, canonical) {
  if(!canonical)return 'awaiting_second_identity_check';
  if(!canonical.countries.includes('india'))return 'canonical_country_mismatch';
  if(!r.names.includes(normalize(canonical.name)))return 'canonical_title_mismatch';
  if(r.tmdbIds.length && (!canonical.tmdbId || !r.tmdbIds.includes(canonical.tmdbId)))return 'canonical_tmdb_mismatch';
  const year=yearOf(item.releaseInfo);
  if(year&&canonical.year&&year!==canonical.year)return 'canonical_year_mismatch';
  return null;
}

function safeImage(url) {try {const u=new URL(url);return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}}

export function releaseDate(value) {
  const day=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const date=new Date(day+'T00:00:00.000Z');
  return Number.isFinite(date.getTime())&&date.toISOString().startsWith(day)?date.toISOString():null;
}

export function newestFirst(movies) {
  return [...movies].sort((a,b)=>{
    const date=x=>releaseDate(x.released)||`${yearOf(x.releaseInfo)||'0000'}-01-01T00:00:00.000Z`;
    return date(b).localeCompare(date(a))||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
  });
}

export function assemble(candidates, identities, canonicals, checkedAt) {
  const counts={},movies=[],seen=new Set();
  for(const item of candidates) {
    if(seen.has(item.id))continue;seen.add(item.id);
    const identity=identities[item.id];
    const reason=wikiReason(item,identity) || canonicalReason(item,identity,canonicals[item.id]);
    if(reason){counts[reason]=(counts[reason]||0)+1;continue;}
    const languages=identity.languages.map(id=>LANGUAGES[id]||'Other');
    const canonical=canonicals[item.id];
    const posterCandidates=[...new Set([safeImage(canonical.poster),`https://images.metahub.space/poster/small/${item.id}/img`,safeImage(item.poster)].filter(Boolean))];
    movies.push({id:item.id,type:'movie',name:plain(canonical.name),poster:posterCandidates[0],posterCandidates,releaseInfo:canonical.year||yearOf(item.releaseInfo)||undefined,released:releaseDate(canonical.released)||undefined,
      description:`Indian film. Original language: ${languages.join(', ')}. Indexed with Telugu audio in MediaFusion's ${item.sourceCatalog==='telugu_hdrip'?'Telugu HD':'Telugu dubbed'} catalog. Sorted by film release date, with release year as fallback; the exact Telugu OTT premiere date is not supplied.`,
      genres:languages,originalLanguageIds:identity.languages,sourceCatalog:item.sourceCatalog,wikidata:identity.items[0],sourceRank:item.sourceRank,identityCheckedAt:identity.checkedAt});
  }
  return {checkedAt,movies:newestFirst(movies),counts,candidateCount:candidates.length,sortOrder:'film_release_date_desc',limits:[
    'Telugu audio is reported by a release index, not independently measured from video files.',
    'Newest first by film release date, falling back to film release year. These are not Telugu OTT premiere dates.',
    'Coverage is bounded to the configured number of source pages. Unknown or conflicting identities are excluded.',
    'Wikidata supplies original language and country; Cinemeta independently checks country, title, TMDB ID and year.',
    'Availability is not verified for a particular streaming subscription or country.'
  ]};
}

export async function refresh(previous={}, options={}) {
  const fetcher=options.fetcher||fetch,now=options.now||Date.now();
  const checkedAt=new Date(now).toISOString();
  const pages=Math.max(1,Math.min(6,Number(options.pages)||3));
  const maxNew=Math.max(1,Math.min(200,Number(options.maxNew)||20));
  const jobs=[];
  for(let page=0;page<pages;page++)for(const catalog of ['telugu_hdrip','telugu_dubbed'])jobs.push({catalog,page});
  const pagesData=await parallelMap(jobs,2,async job=>{
    const extra=job.page?`/skip=${job.page*100}`:'';
    const data=await jsonFetch(`https://mediafusion.elfhosted.com/catalog/movie/${job.catalog}${extra}.json`,fetcher);
    if(!Array.isArray(data.metas))throw new Error('Invalid catalog metadata response');
    return data.metas.filter(x=>/^tt\d+$/.test(x.id||'')).map((x,i)=>({...x,sourceCatalog:job.catalog,sourceRank:job.page*200+i*2+(job.catalog==='telugu_dubbed'?1:0)}));
  });
  const byId=new Map();
  for(const item of pagesData.flat().sort((a,b)=>a.sourceRank-b.sourceRank))if(!byId.has(item.id))byId.set(item.id,item);
  const candidates=[...byId.values()];
  if(!candidates.length)throw new Error('Source catalog is empty; preserving the last successful catalog');
  const active=new Set(candidates.map(x=>x.id));
  const identities=Object.fromEntries(Object.entries(previous.identities||{}).filter(([id])=>active.has(id)));
  const canonicals=Object.fromEntries(Object.entries(previous.canonicals||{}).filter(([id])=>active.has(id)));
  const pending=candidates.filter(x=>{
    const identity=identities[x.id];
    const ttl=identity?.items.length && identity?.languages.length ? 7*86400000 : MAX_AGE;
    return !identity || now-Date.parse(identity.checkedAt)>=ttl;
  }).map(x=>x.id);
  const batches=[];for(let i=0;i<pending.length;i+=100)batches.push(pending.slice(i,i+100));
  const responses=await parallelMap(batches,2,ids=>jsonFetch('https://query.wikidata.org/sparql?'+new URLSearchParams({query:wikiQuery(ids),format:'json'}),fetcher));
  responses.forEach((data,i)=>{
    if(!Array.isArray(data.results?.bindings))throw new Error('Invalid Wikidata response');
    const found=wikiRecords(data.results.bindings,checkedAt);
    // Cache absent identities briefly without ever displaying them.
    for(const id of batches[i])identities[id]=found[id]||{items:[],names:[],languages:[],countries:[],tmdbIds:[],years:[],checkedAt};
  });
  const toCheck=candidates.filter(x=>!wikiReason(x,identities[x.id])&&(!canonicals[x.id]||canonicals[x.id].schemaVersion!==2||now-Date.parse(canonicals[x.id].checkedAt)>7*86400000)).slice(0,maxNew);
  const refreshWarnings=[];
  await parallelMap(toCheck,3,async item=>{
    try {
      const data=await jsonFetch(`https://v3-cinemeta.strem.io/meta/movie/${item.id}.json`,fetcher),m=data.meta;
      if(!m||m.id!==item.id)throw new Error('Invalid independent identity response');
      canonicals[item.id]={name:plain(m.name),countries:String(m.country||'').split(',').map(x=>x.trim().toLowerCase()),tmdbId:m.moviedb_id?String(m.moviedb_id):null,year:yearOf(m.releaseInfo||m.year||m.released),released:releaseDate(m.released),poster:safeImage(m.poster),schemaVersion:2,checkedAt};
    } catch(error) {
      // A single unavailable film must not prevent other identities being checked.
      refreshWarnings.push(`${item.id}: ${String(error.message||error).slice(0,160)}`);
    }
  });
  const result=assemble(candidates,identities,canonicals,checkedAt);
  // A failed refresh must never silently replace a useful catalog with an empty one.
  if(previous.movies?.length && !result.movies.length)throw new Error('No verified titles in refresh; preserving the last successful catalog');
  return {...result,identities,canonicals,refreshWarnings,version:VERSION,sourcePagesPerCatalog:pages};
}

export function manifest() {
  return {id:'private.telugu.dubbed.digital.catalog',version:VERSION,name:'Telugu Dubs — Digital Catalog',description:'Catalog only. Indian films indexed with Telugu audio; Telugu originals and unverified identities excluded. Newest first by film release date/year. Exact Telugu OTT premiere dates unavailable. Metadata: MediaFusion, Wikidata and Cinemeta.',resources:['catalog'],types:['movie'],catalogs:[{type:'movie',id:'telugu-dubbed',name:'Telugu Dubs — Digital',extra:[{name:'skip'},{name:'search'},{name:'genre',options:['Tamil','Hindi','Malayalam','Kannada','English','Bengali','Marathi','Punjabi','Odia','Other']}]}],behaviorHints:{configurable:false}};
}

export function catalog(data,extra='') {
  if(extra.length>2000)throw new Error('Invalid extra parameters');
  const params=new URLSearchParams(extra.includes('=')?extra:decodeURIComponent(extra));
  const rawSkip=params.get('skip')||'0';if(!/^\d{1,6}$/.test(rawSkip))throw new Error('Invalid skip');
  const skip=Number(rawSkip),search=normalize((params.get('search')||'').slice(0,200)),genre=params.get('genre');
  const items=newestFirst(data.movies||[]).filter(x=>(!search||normalize(x.name).includes(search))&&(!genre||x.genres.includes(genre)));
  const metas=items.slice(skip,skip+100).map(({originalLanguageIds,sourceCatalog,wikidata,sourceRank,identityCheckedAt,posterCandidates,...meta})=>meta);
  return {metas,cacheMaxAge:600,staleRevalidate:3600};
}

export function status(data) {return {version:VERSION,sortOrder:data.sortOrder||null,verifiedMovieCount:data.movies?.length||0,checkedAt:data.checkedAt||null,stale:!data.checkedAt||Date.now()-Date.parse(data.checkedAt)>MAX_AGE,candidateCount:data.candidateCount||0,exclusions:data.counts||{},sourcePagesPerCatalog:data.sourcePagesPerCatalog||0,limits:data.limits||[],refreshWarnings:data.refreshWarnings||[],lastError:data.lastError||null};}

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
  const match=route.match(/^\/catalog\/movie\/telugu-dubbed(?:\/(.*))?\.json$/);
  if(match){
    if(!data.checkedAt)return Response.json({error:'Initial metadata refresh has not completed.'},{status:503,headers});
    try{return Response.json(catalog(data,match[1]||''),{headers});}catch{return Response.json({error:'Invalid catalog parameters'},{status:400,headers});}
  }
  return new Response('Not found',{status:404,headers});
}
