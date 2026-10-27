import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {seriesCatalog,seriesStatus,SERIES_ID} from './src/series-core.mjs';
import {cachePosters} from './posters.mjs';
export async function exportSeries(data,destination=new URL('./public/',import.meta.url)){
  if(!data.series?.length)throw new Error('Refusing to export an empty series catalog');
  const route=`catalog/series/${SERIES_ID}`;
  await mkdir(new URL(route+'/',destination),{recursive:true});
  const save=(name,body)=>writeFile(new URL(name,destination),JSON.stringify(body));
  await save(route+'.json',seriesCatalog(data));
  for(let skip=0;skip<=Math.ceil(data.series.length/100)*100;skip+=100)await save(`${route}/skip=${skip}.json`,seriesCatalog(data,`skip=${skip}`));
  const folder=new URL('series/',destination);await mkdir(folder,{recursive:true});
  await save('series/status.json',{...seriesStatus(data),staleAfter:new Date(Date.parse(data.checkedAt)+6*3600000).toISOString()});
  await save('series/coverage.json',{checkedAt:data.checkedAt,accepted:data.series.map(({poster,posterCandidates,...facts})=>facts),excluded:data.audit||[],sources:data.sourceStatus,limits:data.limits});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const data=JSON.parse(await readFile(new URL('./data/series.json',import.meta.url),'utf8'));
  await exportSeries(data);
  const repo=process.env.GITHUB_REPOSITORY,base=process.env.ADDON_BASE_URL||(repo?`https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/`:null);
  if(!base)throw new Error('Set ADDON_BASE_URL to the add-on URL');
  console.log(JSON.stringify(await cachePosters({movies:data.series},new URL('./public/',import.meta.url),base,{catalogType:'series',catalogId:SERIES_ID,statusPath:'series/status.json'})));
}
