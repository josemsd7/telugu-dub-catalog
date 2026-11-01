import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {manifest,handle} from './src/core.mjs';
import {titleMeta} from './src/title-meta.mjs';
import {refreshTitleMetadata,exportTitleMetadata} from './metadata.mjs';
import {exportStatic} from './export.mjs';
import {exportSeries} from './export-series.mjs';

const movie={id:'tt12345',type:'movie',name:'Catalog movie',poster:'https://example.org/movie.jpg',genres:['Tamil'],platforms:[]};
const series={id:'tt23456',type:'series',name:'Catalog series',poster:'https://example.org/series.jpg',genres:['Hindi'],platforms:[]};
const rawMovie={id:movie.id,type:'movie',name:'Movie',description:'Movie plot',country:'India',cast:['Actor One'],streams:[{url:'https://example.org/play'}]};
const rawSeries={id:series.id,type:'series',name:'Series',description:'Series plot',videos:[{id:'tt23456:1:1',title:'Premiere',season:1,episode:1,released:'2026-01-01T00:00:00Z',streams:[{url:'https://example.org/play'}]},{id:'tt99999:1:1',title:'Wrong series',season:1,episode:1,released:'2026-01-01T00:00:00Z'}]};
const checkedAt='2026-10-30T00:00:00Z';
const cache={entries:{'movie/tt12345':{checkedAt,meta:rawMovie},'series/tt23456':{checkedAt,meta:rawSeries}}};

test('manifest advertises scoped metadata for its own movie and series IDs without streams',()=>{
 const info=manifest([movie],[series]);
 assert.deepEqual(info.resources,['catalog',{name:'meta',types:['movie'],idPrefixes:['tt12345']},{name:'meta',types:['series'],idPrefixes:['tt23456']}]);
 assert.equal(info.resources.some(x=>x==='stream'||x.name==='stream'),false);
});
test('metadata preserves catalog identity and episode IDs and excludes inline streams',()=>{
 assert.equal(titleMeta(movie,rawMovie).name,'Catalog movie');
 assert.equal(titleMeta(movie,rawMovie).streams,undefined);
 const meta=titleMeta(series,rawSeries);assert.equal(meta.videos.length,1);assert.equal(meta.videos[0].id,'tt23456:1:1');assert.equal(meta.videos[0].streams,undefined);
 assert.throws(()=>titleMeta(movie,rawSeries),/identity mismatch/);
 assert.throws(()=>titleMeta(series,{...rawSeries,videos:[]}),/episode.*unavailable/);
});
test('cached details survive an upstream outage and missing identities cannot be published',async()=>{
 const now=Date.parse(checkedAt)+8*86400000;
 const fetcher=async()=>new Response('',{status:503});
 const result=await refreshTitleMetadata([movie,series],cache,{now,fetcher});
 assert.equal(Object.keys(result.entries).length,2);assert.equal(result.warnings.length,2);
 await assert.rejects(refreshTitleMetadata([series],{},{now,fetcher}),/complete title details/);
});
test('the exported add-on supplies metadata and series episode routes declared in its manifest',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'telugu-meta-')),dest=pathToFileURL(directory+'/');
 try{
  await exportStatic({checkedAt,movies:[movie]},dest);await exportSeries({checkedAt,series:[series]},dest);
  await exportTitleMetadata([movie,series],cache,dest);
  const info=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  assert.ok(info.resources.some(r=>r.name==='meta'&&r.types.includes('movie')&&r.idPrefixes.includes(movie.id)));
  assert.ok(info.resources.some(r=>r.name==='meta'&&r.types.includes('series')&&r.idPrefixes.includes(series.id)));
  const detail=JSON.parse(await readFile(join(directory,'meta/series/tt23456.json'),'utf8'));
  assert.equal(detail.meta.id,series.id);assert.equal(detail.meta.videos[0].id,'tt23456:1:1');
  assert.equal(JSON.parse(await readFile(join(directory,'meta/movie/tt12345.json'),'utf8')).meta.id,movie.id);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('local metadata routes are type-scoped and do not fetch unknown titles',async()=>{
 const token='abcdefghijklmnopqrstuvwxyz123456',store={get:async()=>({checkedAt,movies:[movie]}),getSeries:async()=>({checkedAt,series:[series]}),getDetails:async()=>cache};
 const request=path=>handle(new Request('https://example.org/'+token+path),{ADDON_TOKEN:token},store,{fetcher:async()=>{throw Error('Unexpected fetch');}});
 const info=await (await request('/manifest.json')).json();assert.ok(info.resources.some(x=>x.name==='meta'));
 assert.equal((await (await request('/meta/movie/tt12345.json')).json()).meta.id,movie.id);
 assert.equal((await (await request('/meta/series/tt23456.json')).json()).meta.videos.length,1);
 assert.equal((await request('/meta/movie/tt23456.json')).status,404);
 assert.equal((await request('/meta/series/tt99999.json')).status,404);
 assert.equal((await request('/stream/movie/tt12345.json')).status,404);
});
