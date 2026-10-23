import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {refresh,status} from './src/core.mjs';
const dir=new URL('./data/',import.meta.url);await mkdir(dir,{recursive:true});
const file=new URL('catalog.json',dir);let previous={};try{previous=JSON.parse(await readFile(file,'utf8'));}catch{}
const begin=Date.now();
const result=await refresh(previous,{onProgress:message=>console.log(message)});
await writeFile(new URL('catalog.json.tmp',dir),JSON.stringify(result));await rename(new URL('catalog.json.tmp',dir),file);
const report={...status(result),durationSeconds:(Date.now()-begin)/1000,examples:result.movies.slice(0,12).map(x=>({id:x.id,name:x.name,year:x.releaseInfo,ottReleaseDate:x.ottReleaseDate,platforms:x.platforms,originalLanguage:x.genres,originalLanguageEvidence:x.originalLanguageEvidence}))};
await writeFile(new URL('./validation-live.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!result.movies.length)process.exitCode=1;
