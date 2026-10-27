import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseSource} from './src/source-refresh.mjs';
import {cleanSeriesTitle,seriesSeason,seriesSourceReason,parseSeriesFacts,mergeSeriesListings,refreshSeries,assessSeries} from './src/series-refresh.mjs';
import {seriesCatalog} from './src/series-core.mjs';
import {manifest,catalog,handle} from './src/core.mjs';
import {exportStatic} from './export.mjs';
import {exportSeries} from './export-series.mjs';
import {cachePosters} from './posters.mjs';
const row={title:'Example Season 2',ottReleaseDate:'2026-10-10',dateText:'10 Oct 2026',languageText:'Hindi to Telugu',genreText:'Series',castText:'Actor One',platforms:['Netflix'],sourceName:'Test source',sourceUrl:'https://example.org/release',sourceRank:0};
const listing=(date,season)=>({sourceName:'Test',sourceUrl:'https://example.org/',ottReleaseDate:date,season,platforms:['Netflix']});
const show={id:'tt12345',type:'series',name:'Example',genres:['Hindi'],poster:'https://example.org/poster.jpg',releaseListings:[listing('2026-10-10',2)]};
const movie={id:'tt77777',type:'movie',name:'Movie',genres:['Hindi'],ottReleaseDate:'2026-10-09'};

test('series parser reads season and audio fields without admitting movie cards',()=>{
 const html='<a href="/series/34/season/2" data-languages="Hindi,Telugu" data-platforms="Netflix"><img alt="Example"><b>Oct 10, 2026</b><h3>Example</h3></a><a href="/movie/Other" data-languages="Telugu" data-platforms="Netflix"><img alt="Other"></a><a href="?page=125">125</a>';
 const p=parseSource(html,'sacnilk-series');assert.equal(p.rows.length,1);assert.equal(p.totalPages,125);assert.equal(p.rows[0].season,2);assert.equal(p.rows[0].genreText,'Series');assert.equal(p.rows[0].languageText,'Hindi,Telugu');
 assert.deepEqual(parseSource(html,'sacnilk').rows.map(x=>x.title),['Other']);
});
test('series filters require audio and exclude films, future releases and uncertain dates',()=>{
 assert.equal(seriesSourceReason(row,'2026-10-27'),null);
 assert.equal(seriesSourceReason({...row,season:1},'2026-10-27'),'conflicting_season');
 assert.equal(seriesSourceReason({...row,title:'A Film',genreText:'Film'},'2026-10-27'),'not_a_series');
 assert.equal(seriesSourceReason({...row,languageText:'Hindi, Telugu subtitles'},'2026-10-27'),'subtitles_not_audio');
 assert.equal(seriesSourceReason({...row,languageText:'Direct Telugu'},'2026-10-27'),'original_telugu');
 assert.equal(seriesSourceReason({...row,languageText:'Hindi to Telugu ~'},'2026-10-27'),'tentative');
 assert.equal(seriesSourceReason({...row,ottReleaseDate:'2026-11-01'},'2026-10-27'),'upcoming');
 assert.equal(seriesSourceReason({...row,languageText:'Korean to Telugu'},'2026-10-27'),'non_indian_language');
 assert.equal(cleanSeriesTitle('Example (Season 2) Web Series'),'Example');assert.equal(cleanSeriesTitle('Example : Season 2'),'Example');assert.equal(seriesSeason({title:'Example S3'}),3);
});
test('TV facts verify the TV ID and never accept a movie with the same numeric ID',()=>{
 const html='<link rel="canonical" href="https://www.themoviedb.org/tv/12"><meta property="og:title" content="Example"><p>Original Language Hindi</p><script type="application/ld+json">{"@type":"TVSeries","url":"https://www.themoviedb.org/tv/12","countryOfOrigin":[{"@type":"Country","name":"India"}]}</script>';
 const facts=parseSeriesFacts(html,12);assert.deepEqual(facts.languageIds,['Q1568']);assert.deepEqual(facts.countries,['india']);
 assert.throws(()=>parseSeriesFacts(html,13),/ID mismatch/);assert.throws(()=>parseSeriesFacts(html.replaceAll('/tv/','/movie/'),12),/ID mismatch/);
});
test('series merge seasons into one show, use earliest report per season, and retain evidence',()=>{
 const result=mergeSeriesListings([{...show,releaseListings:[listing('2026-01-10',1),listing('2026-10-12',2)]},{...show,releaseListings:[listing('2026-10-10',2)]}]);
 assert.equal(result.length,1);assert.equal(result[0].ottReleaseDate,'2026-10-10');assert.deepEqual(result[0].reportedSeasons,[1,2]);assert.equal(result[0].releaseListings.length,3);assert.match(result[0].description,/does not confirm every season/);
});
test('movie and series endpoints cannot mix their datasets',async()=>{
 const shows=mergeSeriesListings([show]),m={checkedAt:'2026-10-27T00:00:00Z',movies:[movie]},s={checkedAt:m.checkedAt,series:[...shows,movie]};
 assert.deepEqual(catalog(m).metas.map(x=>x.type),['movie']);assert.deepEqual(seriesCatalog(s).metas.map(x=>x.type),['series']);
 assert.equal(manifest().catalogs.length,2);
 const token='abcdefghijklmnopqrstuvwxyz123456';
 const request=path=>handle(new Request('https://example.org/'+token+path),{ADDON_TOKEN:token},{get:async()=>m,getSeries:async()=>s});
 assert.equal((await (await request('/catalog/series/telugu-dubbed-series.json')).json()).metas[0].type,'series');
 assert.equal((await (await request('/catalog/movie/telugu-dubbed.json')).json()).metas[0].type,'movie');
 assert.equal((await request('/catalog/movie/telugu-dubbed-series.json')).status,404);
 assert.throws(()=>seriesCatalog(s,'skip=-1'),/Invalid skip/);
});
test('refresh rejects a film returned from series metadata and unconfirmed seasons',async()=>{
 const now=Date.parse('2026-10-27T00:00:00Z');
 for(const type of ['movie','series']){
  const fetcher=async url=>new Response(JSON.stringify(url.includes('/catalog/')?{metas:[{id:'tt12345',name:'Example',type:'series'}]}:{meta:{id:'tt12345',name:'Example',type,country:'India',cast:['Actor One'],moviedb_id:12,videos:[{season:1,released:'2026-01-10T00:00:00Z'}]}}),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(refreshSeries({},{now,source:{rows:[row]},fetcher}),/No verified series/);
 }
});
test('static export provides two separate typed routes, pagination, and series coverage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'series-catalog-')),dest=pathToFileURL(directory+'/');
 try{
  const checkedAt='2026-10-27T00:00:00Z';await exportStatic({checkedAt,movies:[{...movie,platforms:[]}]},dest);await exportSeries({checkedAt,series:mergeSeriesListings([show])},dest);
  const info=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  assert.deepEqual(info.catalogs.map(x=>[x.type,x.id,x.extra]),[['movie','telugu-dubbed',[{name:'skip'}]],['series','telugu-dubbed-series',[{name:'skip'}]]]);
  const read=async path=>JSON.parse(await readFile(join(directory,path),'utf8'));
  assert.equal((await read('catalog/movie/telugu-dubbed.json')).metas[0].id,movie.id);
  assert.equal((await read('catalog/series/telugu-dubbed-series.json')).metas[0].id,show.id);
  assert.deepEqual((await read('catalog/series/telugu-dubbed-series/skip=100.json')).metas,[]);
  assert.equal((await read('series/status.json')).verifiedSeriesCount,1);
  const png=Buffer.from(await readFile(new URL('./src/fallback-poster.base64',import.meta.url),'utf8'),'base64');
  await cachePosters({movies:[show]},dest,'https://example.org/',{catalogType:'series',catalogId:'telugu-dubbed-series',statusPath:'series/status.json',fetcher:async()=>new Response(png,{headers:{'content-type':'image/png'}})});
  assert.match((await read('catalog/series/telugu-dubbed-series.json')).metas[0].poster,/https:\/\/example.org\/posters\//);
  assert.equal((await read('catalog/movie/telugu-dubbed.json')).metas[0].id,movie.id);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('series identities choose the Indian namesake and verified season before testing ambiguity',async()=>{
 const checkedAt='2026-10-27T00:00:00Z',now=Date.parse(checkedAt),r={...row,title:'Example Season 2'};
 const india={id:'tt12345',name:'Example',type:'series',countries:['india'],year:'2020',releaseInfo:'2020-',cast:['Actor One'],directors:[],tmdbId:'12',seasons:[1,2],checkedAt};
 const foreign={...india,id:'tt99999',countries:['united states']};
 const previous={searchCache:{example:{hits:[{id:india.id,name:india.name},{id:foreign.id,name:foreign.name}],checkedAt}},metadataCache:{[india.id]:india,[foreign.id]:foreign},identities:{[india.id]:{items:['Q12345'],languages:['Q1568'],countries:['Q668'],tmdbIds:['12'],checkedAt}}};
 const result=await refreshSeries(previous,{now,source:{rows:[r]},fetcher:async()=>{throw new Error('Unexpected fetch');}});
 assert.equal(result.series.length,1);assert.equal(result.series[0].id,india.id);assert.deepEqual(result.series[0].reportedSeasons,[2]);
});

test('a lone English-original public field cannot relabel an Indian regional original',()=>{
 const match={meta:{name:'Example',countries:['india'],cast:['Actor One'],tmdbId:'12'},titleScore:100,castMatches:1};
 const facts={title:'Example',countries:['india'],languageIds:['Q1860'],sourceUrl:'https://www.themoviedb.org/tv/12'};
 assert.equal(assessSeries(row,match,{items:[],languages:[],countries:[],tmdbIds:[]},facts).reason,'original_language_conflict');
 const generic={...row,languageText:'Hindi, Tamil, Telugu'};
 assert.equal(assessSeries(generic,match,{items:[],languages:[],countries:[],tmdbIds:[]},facts).reason,'english_original_uncorroborated');
 assert.equal(assessSeries({...row,languageText:'English to Telugu'},match,{items:[],languages:[],countries:[],tmdbIds:[]},facts).reason,null);
});
test('a name-only source card cannot override a conflicting host on another release source',async()=>{
 const checkedAt='2026-10-27T00:00:00Z',now=Date.parse(checkedAt);
 const meta={id:'tt12345',name:'Example',type:'series',countries:['india'],year:'2020',releaseInfo:'2020-',cast:['Different Host'],directors:[],tmdbId:'12',seasons:[1,2],checkedAt};
 const previous={searchCache:{example:{hits:[{id:meta.id,name:meta.name}],checkedAt}},metadataCache:{[meta.id]:meta},identities:{[meta.id]:{items:['Q12345'],languages:['Q1568'],countries:['Q668'],tmdbIds:['12'],checkedAt}}};
 const source={rows:[{...row,castText:''},{...row,title:'Example Telugu',castText:'Actor One',languageText:'Telugu'}]};
 await assert.rejects(refreshSeries(previous,{now,source,fetcher:async()=>{throw new Error('Unexpected fetch');}}),/No verified series/);
});
