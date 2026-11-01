import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parallelMap} from './src/identity.mjs';
import {fetchTitleMeta,titleMeta} from './src/title-meta.mjs';

export async function refreshTitleMetadata(items,previous={},options={}) {
  const now=options.now||Date.now(),entries={},warnings=[],errors=[];
  await parallelMap(items,4,async item=>{
    const key=`${item.type}/${item.id}`,old=previous.entries?.[key],ttl=item.type==='series'?6*3600000:7*86400000;
    try{
      if(old&&now-Date.parse(old.checkedAt)<ttl){titleMeta(item,old.meta);entries[key]=old;return;}
      let raw;
      for(let attempt=0;attempt<2;attempt++)try{raw=await fetchTitleMeta(item,options.fetcher);break;}catch(error){if(attempt)throw error;}
      entries[key]={checkedAt:new Date(now).toISOString(),meta:raw};
    }catch(error){
      if(old){try{titleMeta(item,old.meta);entries[key]=old;warnings.push(`${key}: using previous details (${error.message})`);return;}catch{}}
      errors.push(`${key}: ${error.message}`);
    }
  });
  if(errors.length)throw Error('Unable to publish complete title details: '+errors.join('; '));
  return {checkedAt:new Date(now).toISOString(),entries,warnings};
}

export async function exportTitleMetadata(items,cache,destination=new URL('./public/',import.meta.url)) {
  const posters=new Map();
  for(const type of ['movie','series']){
    const count=items.filter(x=>x.type===type).length;
    if(!count)continue;
    const catalogId=type==='movie'?'telugu-dubbed':'telugu-dubbed-series';
    for(let skip=0;skip<count;skip+=100){
      const path=skip?`catalog/${type}/${catalogId}/skip=${skip}.json`:`catalog/${type}/${catalogId}.json`;
      const page=JSON.parse(await readFile(new URL(path,destination),'utf8'));
      for(const item of page.metas)posters.set(`${type}/${item.id}`,item.poster);
    }
  }
  for(const item of items){
    if(!/^tt\d+$/.test(item.id)||!['movie','series'].includes(item.type))throw Error('Invalid metadata route');
    const entry=cache.entries?.[`${item.type}/${item.id}`];
    if(!entry)throw Error('Missing title metadata for '+item.id);
    // Reuse the exact hosted poster URL already emitted in the catalog.
    const poster=posters.get(`${item.type}/${item.id}`);
    const folder=new URL(`meta/${item.type}/`,destination);await mkdir(folder,{recursive:true});
    await writeFile(new URL(`${item.id}.json`,folder),JSON.stringify({meta:titleMeta({...item,poster:poster||item.poster},entry.meta),cacheMaxAge:600,staleRevalidate:3600}));
  }
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const movies=JSON.parse(await readFile(new URL('./data/catalog.json',import.meta.url),'utf8'));
  const series=JSON.parse(await readFile(new URL('./data/series.json',import.meta.url),'utf8'));
  const items=[...movies.movies,...series.series],file=new URL('./data/title-meta.json',import.meta.url);
  let cache={};try{cache=JSON.parse(await readFile(file,'utf8'));}catch{}
  if(process.argv[2]==='refresh'){
    cache=await refreshTitleMetadata(items,cache);await writeFile(file,JSON.stringify(cache));
    console.log(JSON.stringify({titles:Object.keys(cache.entries).length,warnings:cache.warnings}));
  }else if(process.argv[2]==='export'){
    await exportTitleMetadata(items,cache);console.log(`Exported title details for ${items.length} movies and series`);
  }else throw Error('Expected refresh or export');
}
