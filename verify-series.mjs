import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {refreshSeries} from './src/series-refresh.mjs';
const dir=new URL('./data/',import.meta.url);await mkdir(dir,{recursive:true});
const file=new URL('series.json',dir);let previous={};try{previous=JSON.parse(await readFile(file,'utf8'));}catch{}
const result=await refreshSeries(previous,{onProgress:console.log});
await writeFile(new URL('series.json.tmp',dir),JSON.stringify(result));await rename(new URL('series.json.tmp',dir),file);
console.log(JSON.stringify({checkedAt:result.checkedAt,count:result.series.length,exclusions:result.counts,warnings:result.refreshWarnings,examples:result.series.slice(0,15).map(x=>({id:x.id,name:x.name,date:x.ottReleaseDate,latestAired:x.latestAiredDate,seasons:x.reportedSeasons}))},null,2));
