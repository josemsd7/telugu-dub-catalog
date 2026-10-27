import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalize,parallelMap} from './identity.mjs';
export const NINETYONE={key:'91mobiles',name:'91mobiles',url:'https://www.91mobiles.com/entertainment/new-telugu-web-series'};
const SIX_HOURS=6*3600000,MAX_PAGES=20;
const languages=['Telugu','Tamil','Hindi','Malayalam','Kannada','English','Marathi','Bengali','Punjabi','Odia'];
export function parse91(html,kind='list'){
  const r=spawnSync('python3',[fileURLToPath(new URL('./ninetyone_parser.py',import.meta.url)),kind],{input:html,encoding:'utf8',maxBuffer:4*1024*1024});
  if(r.error||r.status!==0)throw new Error(`91mobiles parser: ${String(r.error?.message||r.stderr).slice(0,160)}`);
  return JSON.parse(r.stdout);
}
const clean=x=>normalize(String(x).replace(/\b(?:season\s*\d+|s\d+)\b/gi,'').replace(/\(\s*\)/g,''));
const isFresh=(x,now)=>x?.checkedAt&&now-Date.parse(x.checkedAt)<SIX_HOURS;
export function rowsFrom91(card,facts,today){
  if(clean(card.title)!==clean(facts.title)||card.sourceUrl!==facts.sourceUrl)throw new Error('91mobiles detail identity mismatch');
  const originals=languages.filter(x=>new RegExp(`\\b${x}\\b`,'i').test(facts.originalLanguageText));
  const original=originals.length===1?originals[0]:null;
  const languageText=original==='Telugu'?'Direct Telugu':facts.teluguPlatforms.length?(original?`${original} to Telugu`:'Telugu'):facts.listedAudioLanguages.join(', ');
  const dated=facts.episodes.filter(x=>x.releasedDate<=today),titleSeason=Number(card.title.match(/\bseason\s*(\d+)\b/i)?.[1])||null;
  if(titleSeason&&dated.length&&!dated.some(x=>x.season===titleSeason))throw new Error('91mobiles detail season mismatch');
  const seasons=titleSeason?[titleSeason]:[...new Set(dated.map(x=>x.season))];
  return (seasons.length?seasons:[null]).map(season=>{
    const episodes=dated.filter(x=>x.season===season),dates=episodes.map(x=>x.releasedDate).sort();
    // The first listed episode identifies the season start. Later episodes move
    // the show up without changing or pretending to re-release its first season.
    return {...card,season,ottReleaseDate:dates[0]||card.ottReleaseDate,lastAiredDate:dates.at(-1)||null,
      latestEpisode:episodes.sort((a,b)=>b.releasedDate.localeCompare(a.releasedDate)||b.episode-a.episode)[0]||null,
      platforms:facts.teluguPlatforms,languageText,castText:facts.castText||card.castText,genreText:'Series',
      audioEvidence:'Explicit [Telugu] label on a 91mobiles streaming offer',
      publisherLanguageEvidence:original?'91mobiles language field and Telugu streaming labels':null,
      sourceName:NINETYONE.name,sourceKey:NINETYONE.key};
  });
}
export function list91Url(start){
  return 'https://www.91mobiles.com/entertainment/web/list_ajax.php?'+new URLSearchParams({qp:'contentTypes:show~languages:65',sortOrder:'desc',sortBy:'ottReleaseDate',start:String(start),seoSlug:'/entertainment/new-telugu-web-series',pType:'new-telugu-web-series',dubbedVal:'notDubbed',type:start?'loadmore':'filter'});
}
export async function discover91(previous={},options={}){
  const fetcher=options.fetcher||fetch,now=options.now||Date.now(),checkedAt=new Date(now).toISOString(),today=checkedAt.slice(0,10),windowStart=new Date(now-365*86400000).toISOString().slice(0,10);
  const cache={...(previous.ninetyOneDetailCache||{})},old=previous.sourceSnapshots?.[NINETYONE.key],errors=[];
  const recent=x=>[x.ottReleaseDate,x.lastAiredDate].filter(Boolean).some(d=>d>=windowStart&&d<=today);
  async function request(url){const r=await fetcher(url,{headers:{Accept:'text/html,application/json;q=0.9','User-Agent':'TeluguDubCatalog/0.6 (factual metadata; https://github.com/josemsd7/telugu-dub-catalog)'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r;}
  try{
    // This is the public endpoint used by the page's own Sort and Load more UI.
    const first=await (await request(list91Url(0))).json();
    if(typeof first.response!=='string')throw new Error('Invalid public list response');
    const p=parse91(first.response),total=Number(first.total_records||p.totalRecords),pages=Math.ceil(total/p.pageSize);
    if(!Number.isInteger(pages)||pages<1||pages>MAX_PAGES)throw new Error(`Pagination outside verified limit (${MAX_PAGES} pages)`);
    const cards=[...p.rows];let pagesFetched=1;
    const additional=await parallelMap(Array.from({length:pages-1},(_,i)=>i+1),2,async n=>{
      try{const r=await (await request(list91Url(n))).json();const list=parse91(r.response);pagesFetched++;return list.rows;}
      catch(e){errors.push(`List page ${n+1}: ${e.message}`);return [];}
    });cards.push(...additional.flat());
    const unique=[...new Map(cards.map(x=>[x.sourceUrl,x])).values()];
    options.onProgress?.(`91mobiles: ${unique.length} show cards from ${pagesFetched}/${pages} pages`);
    let detailsChecked=0;
    const rows=(await parallelMap(unique,2,async card=>{
      if(card.originalLanguageText==='Telugu')return [{...card,languageText:'Direct Telugu',platforms:[],sourceName:NINETYONE.name,sourceKey:NINETYONE.key}];
      try{
        let facts=cache[card.sourceUrl];
        if(!isFresh(facts,now)){facts={...parse91(await (await request(card.sourceUrl)).text(),'detail'),checkedAt};cache[card.sourceUrl]=facts;}
        return rowsFrom91(card,facts,today);
      }catch(e){errors.push(`${card.title}: ${e.message}`);const facts=cache[card.sourceUrl];if(facts)try{return rowsFrom91(card,facts,today);}catch{}return [];}
      finally{if(++detailsChecked%15===0)options.onProgress?.(`91mobiles: checked ${detailsChecked} non-Telugu-original detail pages`);}
    })).flat().filter(recent);
    if(!rows.length)throw new Error('No recent verified list rows');
    const kept=errors.length&&old?[...new Map([...old.rows.filter(recent),...rows].map(x=>[[x.sourceUrl,x.season||'',x.ottReleaseDate].join('|'),x])).values()]:rows;
    return {fresh:true,rows:kept,snapshot:{checkedAt,rows:kept},cache,status:{...NINETYONE,state:errors.length?'partial':'ok',checkedAt,rowCount:kept.length,pagesFetched,pagesAvailable:pages,listCardCount:unique.length,teluguAudioRowCount:kept.filter(x=>/to Telugu|^Telugu$/.test(x.languageText)).length,errors}};
  }catch(e){
    const rows=(old?.rows||[]).filter(recent);
    return {fresh:false,rows,snapshot:rows.length?{...old,rows}:null,cache,status:{...NINETYONE,state:rows.length?'cached':'unavailable',checkedAt:old?.checkedAt||null,rowCount:rows.length,error:e.message}};
  }
}
