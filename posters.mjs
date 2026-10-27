import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parallelMap} from './src/core.mjs';

const MAX_BYTES=100000;
const allowedHost=host=>['live.metahub.space','images.metahub.space','m.media-amazon.com','image.tmdb.org','images.tmdb.org','upload.wikimedia.org'].includes(host);
export function imageExtension(bytes) {
  if(bytes.length<256)return null;
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
  return null;
}

async function imageBytes(url,fetcher) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!allowedHost(parsed.hostname))throw new Error('Unsupported poster source');
  const response=await fetcher(url,{headers:{'User-Agent':'TeluguDubCatalog/0.2 (catalog poster caching; no playback)'},signal:AbortSignal.timeout(12000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Poster source unavailable');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('Poster exceeds size limit');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw new Error('Poster exceeds size limit');chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks),extension=imageExtension(bytes);
  if(!extension)throw new Error('Invalid poster image');
  return {bytes,extension};
}

export async function cachePosters(data,destination,baseUrl,options={}) {
  const base=new URL(baseUrl);
  if(!['https:','http:'].includes(base.protocol))throw new Error('Invalid add-on base URL');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  const fetcher=options.fetcher||fetch,folder=new URL('posters/',destination);
  await mkdir(folder,{recursive:true});
  const fallback=Buffer.from(await readFile(new URL('./src/fallback-poster.base64',import.meta.url),'utf8'),'base64');
  const urls=new Map(),failures=[];
  await parallelMap(data.movies,6,async movie=>{
    let image;
    const candidates=[...new Set([...(movie.posterCandidates||[]),`https://images.metahub.space/poster/small/${movie.id}/img`,movie.poster].filter(Boolean))];
    for(const url of candidates){try{image=await imageBytes(url,fetcher);break;}catch{}}
    if(!image){image={bytes:fallback,extension:'png'};failures.push(movie.id);}
    const hash=createHash('sha256').update(image.bytes).digest('hex').slice(0,12);
    const name=`${movie.id}-${hash}.${image.extension}`;
    await writeFile(new URL(name,folder),image.bytes);
    urls.set(movie.id,new URL('posters/'+name,base).href);
  });
  if(failures.length===data.movies.length)throw new Error('All poster sources unavailable; preserving the previous deployment');
  const route=`catalog/${options.catalogType||'movie'}/${options.catalogId||'telugu-dubbed'}`;
  const catalogFolder=new URL(route+'/',destination);
  const files=[new URL(route+'.json',destination),...(await readdir(catalogFolder)).filter(x=>x.endsWith('.json')).map(x=>new URL(x,catalogFolder))];
  for(const file of files){
    const page=JSON.parse(await readFile(file,'utf8'));
    for(const movie of page.metas){movie.poster=urls.get(movie.id);movie.posterShape='poster';}
    await writeFile(file,JSON.stringify(page));
  }
  const stats={total:data.movies.length,actualPosters:data.movies.length-failures.length,fallbackPosters:failures.length,fallbackIds:failures,checkedAt:new Date().toISOString()};
  const statusFile=new URL(options.statusPath||'status.json',destination),status=JSON.parse(await readFile(statusFile,'utf8'));
  await writeFile(statusFile,JSON.stringify({...status,posters:stats}));
  return stats;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const repository=process.env.GITHUB_REPOSITORY;
  const base=process.env.ADDON_BASE_URL||(repository?`https://${repository.split('/')[0]}.github.io/${repository.split('/')[1]}/`:null);
  if(!base)throw new Error('Set ADDON_BASE_URL to the hosted add-on directory URL.');
  const data=JSON.parse(await readFile(new URL('./data/catalog.json',import.meta.url),'utf8'));
  console.log(JSON.stringify(await cachePosters(data,new URL('./public/',import.meta.url),base),null,2));
}

