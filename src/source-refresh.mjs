import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {VERSION,LANGUAGES,normalize,parallelMap,wikiQuery,wikiRecords,releaseDate,newestFirst} from './identity.mjs';

export const SOURCE_URL='https://ottreleasemovies.com/';
const SOURCE_NAME='OTTReleaseMovies';
const SIX_HOURS=6*3600000,WEEK=7*86400000;
const LANGUAGE_IDS={tamil:'Q5885',hindi:'Q1568',malayalam:'Q36236',kannada:'Q33673',marathi:'Q1571',bengali:'Q9610',punjabi:'Q5146',odia:'Q33810',english:'Q1860'};
const UA='TeluguDubCatalog/0.3 (personal catalog factual metadata; https://github.com/josemsd7/telugu-dub-catalog)';
const year=value=>String(value||'').match(/\d{4}/)?.[0]||null;
const stamp=(value,now,ttl)=>value?.checkedAt&&now-Date.parse(value.checkedAt)<ttl;
const safePoster=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}};

export function parseSource(html) {
  const result=spawnSync('python3',[fileURLToPath(new URL('./source_parser.py',import.meta.url))],{input:html,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.error||result.status!==0)throw new Error(`Release parser failed: ${String(result.error?.message||result.stderr).slice(0,180)}`);
  const data=JSON.parse(result.stdout);
  if(!Array.isArray(data.rows)||!data.rows.length)throw new Error('Release source returned no rows');
  return data;
}

export function cleanTitle(title) {
  return String(title||'').replace(/\b(?:web\s*series|movie|film)\b/gi,' ').replace(/\([^)]*\b(?:telugu|tamil|hindi|202\d)\b[^)]*\)/gi,' ').replace(/\b(?:season\s*\d+|\d+\s*-?\s*episodes?)\b/gi,' ').replace(/\bIII\b/g,'3').replace(/\bII\b/g,'2').replace(/\s+/g,' ').trim();
}
const titleKey=value=>normalize(cleanTitle(value).replace(/\band\b/gi,' '));
const phonetic=value=>titleKey(value).replace(/h/g,'').replace(/[gk]/g,'k').replace(/[td]/g,'t').replace(/[bp]/g,'p').replace(/[vw]/g,'v').replace(/(.)\1+/g,'$1');
const titleVariants=value=>{
  const full=cleanTitle(value),main=full.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  const aliases=[...full.matchAll(/\(([^)]+)\)/g)].map(x=>x[1]).filter(x=>!/^re\s*-?\s*release$/i.test(x)&&/[A-Za-z]{3}/.test(x));
  return [...new Set([main,...aliases,full].filter(Boolean))];
};
export function titleScore(source,title) {
  if(titleVariants(source).some(x=>titleKey(x)===titleKey(title)))return 100;
  if(titleVariants(source).some(x=>phonetic(x)===phonetic(title)))return 90;
  const prefix=source.split(':')[0];
  if(source.includes(':')&&!title.includes(':')&&titleKey(prefix).length>=6&&titleKey(prefix)===titleKey(title))return 80;
  return 0;
}

export function sourceReason(row,today) {
  if(!row.ottReleaseDate)return 'missing_ott_date';
  if(row.tentative)return 'tentative_or_subtitles_only';
  if(row.ottReleaseDate>today)return 'upcoming';
  if(/\b(series|season|episodes?|reality|sitcom|show)\b/i.test(row.title+' '+row.genreText))return 'not_a_movie';
  if(!/telugu/i.test(row.languageText))return 'telugu_audio_not_listed';
  if(/subtitles?/i.test(row.languageText))return 'subtitles_not_audio';
  if(/direct\s*telugu|telugu\s*original/i.test(row.languageText))return 'original_telugu';
  if(/\b(korean?|koria|chinese|mandarin|japanese|spanish|french|turkish|arabic)\b/i.test(row.languageText))return 'non_indian_language';
  return null;
}

export function languageHint(row) {
  const match=row.languageText.match(/\b(Tamil|Hindi|Malayalam|Kannada|Marathi|Bengali|Punjabi|Odia|English)\s*(?:to|→|->)\s*Telugu\b/i);
  return match?LANGUAGE_IDS[match[1].toLowerCase()]:null;
}

export function assessFilm(row,match,identity) {
  const meta=match.meta;
  if(identity?.items.length>1)return {reason:'ambiguous_identity'};
  if(identity?.languages.includes('Q8097'))return {reason:'original_telugu'};
  const countries=meta.countries||[];
  if(countries.length&&!countries.includes('india'))return {reason:'non_indian_film'};
  if(!countries.includes('india')&&!identity?.countries.includes('Q668'))return {reason:'indian_origin_unconfirmed'};
  if(identity?.countries.length&&!identity.countries.includes('Q668'))return {reason:'country_conflict'};
  if(identity?.tmdbIds.length&&meta.tmdbId&&!identity.tmdbIds.includes(meta.tmdbId))return {reason:'identity_conflict'};
  if(meta.cast?.length&&row.castText&&match.castMatches===0)return {reason:'cast_mismatch'};
  if(match.titleScore===0)return {reason:'title_mismatch'};
  const hint=languageHint(row),languages=identity?.languages||[];
  if(hint&&languages.length&&!languages.includes(hint))return {reason:'original_language_conflict'};
  const originalLanguages=languages.length?languages:hint?[hint]:[];
  if(!originalLanguages.length)return {reason:'original_language_unconfirmed'};
  return {reason:null,originalLanguages,originalEvidence:languages.length?'Wikidata original-language metadata':'Publisher explicit dubbing-direction label'};
}

async function response(url,fetcher) {
  const result=await fetcher(url,{headers:{Accept:'application/json,text/html;q=0.9','User-Agent':UA},signal:AbortSignal.timeout(18000)});
  if(!result.ok)throw new Error(`Metadata HTTP ${result.status}`);
  return result;
}

function metadata(m,checkedAt) {
  return {id:m.id,name:String(m.name||'').slice(0,300),type:m.type||'movie',countries:String(m.country||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),year:year(m.releaseInfo||m.year||m.released),released:releaseDate(m.released),poster:safePoster(m.poster),tmdbId:m.moviedb_id?String(m.moviedb_id):null,cast:(m.cast||[]).map(String).slice(0,30),directors:(Array.isArray(m.director)?m.director:[m.director]).filter(Boolean).map(String),checkedAt,schemaVersion:3};
}

export async function refreshFromOtt(previous={},options={}) {
  const fetcher=options.fetcher||fetch,now=options.now||Date.now(),checkedAt=new Date(now).toISOString(),today=checkedAt.slice(0,10);
  const source=options.source||parseSource(await (await response(SOURCE_URL,fetcher)).text());
  if(!Array.isArray(source.rows)||!source.rows.length)throw new Error('Release source empty; preserving last successful catalog');
  const counts={},audit=[],warnings=[];
  const record=(row,reason)=>{counts[reason]=(counts[reason]||0)+1;audit.push({title:row.title,ottReleaseDate:row.ottReleaseDate,platforms:row.platforms,reason});};
  const eligible=[];
  for(const row of source.rows){const reason=sourceReason(row,today);if(reason)record(row,reason);else eligible.push(row);}
  eligible.sort((a,b)=>b.ottReleaseDate.localeCompare(a.ottReleaseDate)||a.sourceRank-b.sourceRank);
  options.onProgress?.(`Source: ${source.rows.length} release rows; ${eligible.length} candidates after source filters`);
  const searchCache={...(previous.sourceSearchCache||{})},metaCache={...(previous.sourceMetadataCache||{})},identities={...(previous.identities||{})};
  const searchPromises=new Map(),metaPromises=new Map();
  async function search(row) {
    const key=titleKey(row.title),cached=searchCache[key];
    if(stamp(cached,now,cached?.hits.length?WEEK:SIX_HOURS)){
      const hits=cached.hits.filter(x=>titleScore(row.title,x.name)>0).slice(0,4);
      searchCache[key]={...cached,hits};
      if(hits.length||cached.hits.length===0)return hits;
    }
    if(!searchPromises.has(key))searchPromises.set(key,(async()=>{
      let hits=[];
      const queries=titleVariants(row.title).slice(0,2).map(x=>x.includes(':')?x.split(':')[0].trim():x);
      for(const query of [...new Set(queries)]){
        const url='https://v3-cinemeta.strem.io/catalog/movie/top/search='+encodeURIComponent(query)+'.json';
        const data=await (await response(url,fetcher)).json();
        if(!Array.isArray(data.metas))throw new Error('Invalid movie search response');
        hits=data.metas.filter(x=>/^tt\d+$/.test(x.id||'')&&(!x.type||x.type==='movie')&&titleScore(row.title,x.name)>0).slice(0,4).map(m=>({id:m.id,name:String(m.name||''),year:year(m.releaseInfo),poster:safePoster(m.poster)}));
        if(hits.length)break;
      }
      searchCache[key]={hits,checkedAt};return hits;
    })());
    return searchPromises.get(key);
  }
  async function getMeta(hit) {
    const cached=metaCache[hit.id];if(stamp(cached,now,WEEK))return cached;
    if(!metaPromises.has(hit.id))metaPromises.set(hit.id,(async()=>{
      try{
        const data=await (await response(`https://v3-cinemeta.strem.io/meta/movie/${hit.id}.json`,fetcher)).json();
        if(!data.meta||data.meta.id!==hit.id)throw new Error('Invalid film identity response');
        const result=metadata(data.meta,checkedAt);metaCache[hit.id]=result;return result;
      }catch(error){
        warnings.push(`${hit.id}: ${String(error.message||error).slice(0,100)}`);
        return cached||{...hit,type:'movie',countries:[],cast:[],directors:[],released:null};
      }
    })());
    return metaPromises.get(hit.id);
  }
  let done=0;
  const resolved=(await parallelMap(eligible,4,async row=>{
    try{
      const hits=(await search(row)).filter(x=>titleScore(row.title,x.name)>0).slice(0,3);
      const matches=[];
      for(const hit of hits){
        const meta=await getMeta(hit);
        if(meta.type!=='movie'||(meta.year&&Number(meta.year)>Number(row.ottReleaseDate.slice(0,4))))continue;
        const castText=normalize(row.castText),castMatches=[...(meta.cast||[]),...(meta.directors||[])].filter(x=>normalize(x).length>=4&&castText.includes(normalize(x))).length;
        matches.push({row,meta,titleScore:titleScore(row.title,meta.name),castMatches,score:titleScore(row.title,meta.name)+Math.min(castMatches,4)*15});
      }
      matches.sort((a,b)=>b.score-a.score);
      if(!matches.length){record(row,'no_matching_movie_id');return null;}
      if(matches.length>1&&matches[0].score===matches[1].score){record(row,'ambiguous_movie_match');return null;}
      return matches[0];
    }catch(error){warnings.push(`${row.title}: ${String(error.message||error).slice(0,100)}`);record(row,'movie_lookup_failed');return null;}
    finally{done++;if(done%25===0)options.onProgress?.(`Matched ${done}/${eligible.length} source candidates`);}
  })).filter(Boolean);
  const ids=[...new Set(resolved.map(x=>x.meta.id))];
  const pending=ids.filter(id=>!stamp(identities[id],now,identities[id]?.languages.length?WEEK:SIX_HOURS));
  const batches=[];for(let i=0;i<pending.length;i+=70)batches.push(pending.slice(i,i+70));
  await parallelMap(batches,2,async batch=>{
    try{
      const data=await (await response('https://query.wikidata.org/sparql?'+new URLSearchParams({query:wikiQuery(batch),format:'json'}),fetcher)).json();
      if(!Array.isArray(data.results?.bindings))throw new Error('Invalid original-language response');
      const found=wikiRecords(data.results.bindings,checkedAt);
      for(const id of batch)identities[id]=found[id]||{items:[],names:[],languages:[],countries:[],tmdbIds:[],years:[],checkedAt};
    }catch(error){warnings.push('Original-language lookup: '+String(error.message||error).slice(0,120));}
  });
  const byId=new Map();
  for(const match of resolved){
    const {row,meta}=match,assessment=assessFilm(row,match,identities[meta.id]);
    if(assessment.reason){record(row,assessment.reason);continue;}
    const languages=assessment.originalLanguages.map(x=>LANGUAGES[x]||'Other');
    const posters=[...new Set([meta.poster,`https://images.metahub.space/poster/small/${meta.id}/img`].filter(Boolean))];
    const old=byId.get(meta.id);
    if(old){old.platforms=[...new Set([...old.platforms,...row.platforms])];continue;}
    byId.set(meta.id,{id:meta.id,type:'movie',name:cleanTitle(row.title),canonicalName:meta.name,poster:posters[0],posterCandidates:posters,releaseInfo:meta.year||undefined,released:meta.released||undefined,genres:languages,
      description:`OTT release listed: ${row.ottReleaseDate}${row.platforms.length?' — '+row.platforms.join(', '):''}. Original language: ${languages.join(', ')}. Telugu audio is reported by OTTReleaseMovies; subscription and regional availability are not independently checked. Source: ${row.sourceUrl}`,
      links:[{name:'OTT release source',category:'Source',url:row.sourceUrl}],ottReleaseDate:row.ottReleaseDate,platforms:row.platforms,sourceTitle:row.title,sourceUrl:row.sourceUrl,originalLanguageIds:assessment.originalLanguages,originalLanguageEvidence:assessment.originalEvidence,sourceRank:row.sourceRank});
  }
  const movies=newestFirst([...byId.values()]);
  if(!movies.length)throw new Error('No verified films from release source; preserving the last successful catalog');
  const keep=new Set(ids),searchKeys=new Set(eligible.map(x=>titleKey(x.title)));
  return {version:VERSION,checkedAt,movies,candidateCount:eligible.length,sourceRowCount:source.rows.length,sourceName:SOURCE_NAME,sourceUrl:SOURCE_URL,sortOrder:'source_ott_release_date_desc',counts,refreshWarnings:warnings,audit,
    sourceSearchCache:Object.fromEntries(Object.entries(searchCache).filter(([k])=>searchKeys.has(k))),sourceMetadataCache:Object.fromEntries(Object.entries(metaCache).filter(([id])=>keep.has(id))),identities:Object.fromEntries(Object.entries(identities).filter(([id])=>keep.has(id))),
    limits:['OTT dates and Telugu audio are reported by OTTReleaseMovies, a third-party editorial source; actual audio tracks and regional subscriptions are not inspected.','Only dated, non-tentative movie entries with Telugu audio listed are considered. Series, explicit Telugu originals, and non-Indian films are excluded.','Original language uses Wikidata where available, otherwise the publisher must explicitly identify a non-Telugu original language. Unknown or conflicting originals are excluded.','Film identities use Cinemeta title, cast, country and year checks. Unmatched or ambiguous titles remain excluded and are reported in coverage data.','Coverage follows the source page and is not a guarantee of every platform or every Telugu dub. Source layout changes or outages can interrupt updates; the last successful deployment is preserved.']};
}
