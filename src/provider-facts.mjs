import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parallelMap} from './identity.mjs';

export function parseProviderFacts(html,url,type='Movie') {
  const u=new URL(url);
  if(u.origin!=='https://www.netflix.com'||!/^\/in\/title\/\d+$/.test(u.pathname)||u.search||u.hash)throw Error('Unsupported public title URL');
  const result=spawnSync('python3',[fileURLToPath(new URL('./provider_parser.py',import.meta.url)),url,type],{input:html,encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Error('Linked public title facts unavailable or conflicting');
  return JSON.parse(result.stdout);
}

export async function enrichProviderRows(rows,previous={},options={}) {
  const cache={...previous},warnings=[],now=options.now||Date.now(),checkedAt=new Date(now).toISOString();
  const fetcher=options.fetcher||fetch,type=options.type||'Movie',score=options.titleScore;
  const urls=[...new Set(rows.map(r=>r.providerUrl).filter(Boolean))];
  await parallelMap(urls,2,async url=>{
    try{
      const u=new URL(url);
      if(u.origin!=='https://www.netflix.com'||!/^\/in\/title\/\d+$/.test(u.pathname)||u.search||u.hash)throw Error('Unsupported public title URL');
      if(cache[url]?.type===type&&now-Date.parse(cache[url].checkedAt)<7*86400000)return;
      const response=await fetcher(url,{headers:{Accept:'text/html','User-Agent':'TeluguDubCatalog/0.7 (public factual metadata)'},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      cache[url]={...parseProviderFacts(await response.text(),url,type),checkedAt};
    }catch(error){warnings.push(`Linked title ${url}: ${error.message}`);}
  });
  return {rows:rows.map(row=>{
    const facts=cache[row.providerUrl];
    if(!facts||facts.type!==type||score(row.title,facts.title)===0)return row;
    return {...row,castText:[row.castText,...facts.cast].filter(Boolean).join(', '),castEvidenceUrl:facts.sourceUrl};
  }),cache:Object.fromEntries(Object.entries(cache).filter(([url])=>urls.includes(url))),warnings};
}
