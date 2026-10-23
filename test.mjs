import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {manifest,catalog,handle,refresh,newestFirst} from './src/core.mjs';
import {parseSource,sourceReason,assessFilm,titleScore} from './src/source-refresh.mjs';
import {exportStatic} from './export.mjs';
import {cachePosters} from './posters.mjs';

const stamp='2026-10-23T10:00:00Z';
const row={title:'Mandaadi',ottReleaseDate:'2026-10-08',dateText:'08th Oct 2026',languageText:'Tamil to Telugu',genreText:'Action Drama',castText:'Soori, Suhas, Mahima Nambiar',platforms:['Netflix'],sourceUrl:'https://ottreleasemovies.com/',sourceRank:0,tentative:false};
const meta={id:'tt36596965',name:'Mandaadi',type:'movie',countries:['india'],cast:['Soori','Suhas'],directors:[],year:'2026',tmdbId:'1465943'};
const match={row,meta,titleScore:100,castMatches:2};
const identity={items:['Q134704471'],names:['mandaadi'],countries:['Q668'],languages:[],tmdbIds:['1465943'],checkedAt:stamp};
const movie={id:meta.id,type:'movie',name:meta.name,releaseInfo:'2026',ottReleaseDate:'2026-10-08',genres:['Tamil'],originalLanguageIds:['Q5885'],poster:'https://images.metahub.space/poster/small/tt36596965/img',posterCandidates:['https://images.metahub.space/poster/small/tt36596965/img'],platforms:['Netflix']};
const accepted={checkedAt:stamp,movies:[movie],sortOrder:'source_ott_release_date_desc',sourceName:'OTTReleaseMovies'};
const html='<table><tr><th>Movie/ Series</th><th>OTT Release Date</th><th>OTT Platform</th><th>Genre</th><th>Direct/ Dubbing?</th><th>Lead Roles</th></tr><tr><td><a href="https://ottreleasemovies.com/mandaadi/">Mandaadi</a></td><td>08th Oct 2026</td><td><img src="/netflix-logo-new.png"></td><td>Action Drama</td><td>Tamil to Telugu</td><td>Soori, Suhas</td></tr></table>';

test('public HTML parser extracts OTT dates, dubbing direction, platform and source link',()=>{
  const parsed=parseSource(html);assert.equal(parsed.sourceRowCount,1);
  assert.equal(parsed.rows[0].ottReleaseDate,'2026-10-08');
  assert.deepEqual(parsed.rows[0].platforms,['Netflix']);
  assert.equal(parsed.rows[0].languageText,'Tamil to Telugu');
  assert.equal(parsed.rows[0].sourceUrl,'https://ottreleasemovies.com/mandaadi/');
  assert.throws(()=>parseSource('<html>No table</html>'),/Release parser failed/);
});
test('source filters exclude upcoming, tentative, subtitle-only, series and explicit Telugu originals',()=>{
  assert.equal(sourceReason({...row,ottReleaseDate:'2026-11-01'},'2026-10-23'),'upcoming');
  assert.equal(sourceReason({...row,tentative:true},'2026-10-23'),'tentative_or_subtitles_only');
  assert.equal(sourceReason({...row,languageText:'Malayalam with Telugu subtitles'},'2026-10-23'),'subtitles_not_audio');
  assert.equal(sourceReason({...row,title:'Example Season 2'},'2026-10-23'),'not_a_movie');
  assert.equal(sourceReason({...row,languageText:'Direct Telugu'},'2026-10-23'),'original_telugu');
});
test('an explicit source dub label permits a verified Indian film when Wikidata original language is missing',()=>{
  const result=assessFilm(row,match,identity);
  assert.equal(result.reason,null);assert.deepEqual(result.originalLanguages,['Q5885']);
  assert.match(result.originalEvidence,/Publisher/);
});
test('original Telugu and conflicting or unknown originals fail closed',()=>{
  assert.equal(assessFilm(row,match,{...identity,languages:['Q8097']}).reason,'original_telugu');
  assert.equal(assessFilm({...row,languageText:'Telugu, Tamil'},match,identity).reason,'original_language_unconfirmed');
  assert.equal(assessFilm(row,match,{...identity,languages:['Q1568']}).reason,'original_language_conflict');
});
test('foreign productions and mismatched cast cannot enter the catalog',()=>{
  assert.equal(assessFilm(row,{...match,meta:{...meta,countries:['united states']}},identity).reason,'non_indian_film');
  assert.equal(assessFilm(row,{...match,castMatches:0},identity).reason,'cast_mismatch');
  assert.equal(titleScore('Makutam','Magudam'),90);
  assert.equal(titleScore('Mandaadi','Mardaani'),0);
  assert.equal(titleScore('Example Local Title (Original Name)','Original Name'),100);
  assert.equal(titleScore('The India Story: Slow Poison in Progress','The India Story'),80);
});
test('OTT dates take priority over original cinema dates and source table order',()=>{
  const a={...movie,id:'tt1',name:'A',released:'2026-09-10',ottReleaseDate:'2026-10-08'};
  const b={...movie,id:'tt2',name:'B',released:'2020-01-01',ottReleaseDate:'2026-10-23'};
  assert.deepEqual(newestFirst([a,b]).map(x=>x.id),['tt2','tt1']);
});
test('manifest exposes only a movie catalog',()=>{
  assert.deepEqual(manifest().resources,['catalog']);assert.deepEqual(manifest().types,['movie']);
});
test('pagination happens after OTT sorting and audit fields are kept out of Stremio responses',()=>{
  const movies=Array.from({length:173},(_,i)=>({...movie,id:'tt'+(1000000+i),name:'Film '+i,ottReleaseDate:i<73?'2026-06-01':'2026-10-08'}));
  assert.equal(catalog({movies}).metas.length,100);
  assert.equal(catalog({movies},'skip=100').metas.length,73);
  assert.equal(catalog({movies},'search=Film%2072').metas[0].name,'Film 72');
  assert.equal(catalog({movies},'genre=Hindi').metas.length,0);
  assert.equal('ottReleaseDate' in catalog({movies}).metas[0],false);
  assert.equal('posterCandidates' in catalog({movies}).metas[0],false);
  assert.throws(()=>catalog({movies},'skip=-1'));
});
test('HTTP routes protect the local token and do not implement streams',async()=>{
  const token='testing_token_01234567890123456789',env={ADDON_TOKEN:token},store={get:async()=>accepted};
  const request=path=>handle(new Request('https://addon.invalid'+path),env,store);
  assert.equal((await request('/manifest.json')).status,404);
  assert.equal((await request('/'+token+'/stream/movie/tt36596965.json')).status,404);
  assert.equal((await request('/'+token+'/catalog/movie/telugu-dubbed.json')).status,200);
});
test('a failed refresh preserves the prior snapshot',async()=>{
  await assert.rejects(refresh(accepted,{fetcher:async()=>new Response('',{status:503})}),/503/);
  assert.equal(accepted.movies.length,1);
});
test('the full refresh matches a source row, resolves the film and uses its OTT date',async()=>{
  const fetcher=async url=>{
    const value=String(url);
    if(value==='https://ottreleasemovies.com/')return new Response(html);
    if(value.includes('/catalog/'))return Response.json({metas:[{id:meta.id,type:'movie',name:meta.name,releaseInfo:'2026'}]});
    if(value.includes('/meta/'))return Response.json({meta:{id:meta.id,type:'movie',name:meta.name,country:'India',cast:['Soori'],moviedb_id:1465943,releaseInfo:'2026',released:'2026-09-10'}});
    throw Error('Unexpected network request');
  };
  const result=await refresh({identities:{[meta.id]:identity}},{fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(result.movies[0].ottReleaseDate,'2026-10-08');
  assert.equal(result.sourceName,'OTTReleaseMovies');assert.equal(result.sortOrder,'source_ott_release_date_desc');
});
test('static export includes a factual coverage audit and only supported routes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'telugu-dub-test-'));
  try {
    await exportStatic(accepted,pathToFileURL(directory+'/'));
    const info=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
    assert.deepEqual(info.resources,['catalog']);assert.deepEqual(info.catalogs[0].extra,[{name:'skip'}]);
    assert.equal(JSON.parse(await readFile(join(directory,'catalog/movie/telugu-dubbed.json'),'utf8')).metas.length,1);
    assert.equal(JSON.parse(await readFile(join(directory,'coverage.json'),'utf8')).accepted[0].ottReleaseDate,'2026-10-08');
    assert.equal(JSON.parse(await readFile(join(directory,'status.json'),'utf8')).staleAfter,'2026-10-23T16:00:00.000Z');
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('broken image URLs use another image source and hosted URLs are valid PNGs',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'telugu-poster-test-'));
  try {
    const destination=pathToFileURL(directory+'/');
    const png=Buffer.from(await readFile(new URL('./src/fallback-poster.base64',import.meta.url),'utf8'),'base64');
    const movies=[{...movie,posterCandidates:['https://live.metahub.space/broken','https://m.media-amazon.com/working.png']},{...movie,id:'tt7654321',posterCandidates:[],poster:null}];
    const data={...accepted,movies};await exportStatic(data,destination);
    const fetcher=async url=>String(url).endsWith('working.png')?new Response(png,{headers:{'content-type':'image/png'}}):new Response('unavailable',{status:403});
    const stats=await cachePosters(data,destination,'https://addon.example/catalog/',{fetcher});
    assert.equal(stats.actualPosters,1);assert.equal(stats.fallbackPosters,1);
    const page=JSON.parse(await readFile(join(directory,'catalog/movie/telugu-dubbed.json'),'utf8'));
    for(const item of page.metas){assert.match(item.poster,/^https:\/\/addon\.example\/catalog\/posters\/tt\d+-[a-f0-9]+\.png$/);}
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('a total poster source outage stops publication',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'telugu-poster-outage-'));
  try {
    const destination=pathToFileURL(directory+'/');await exportStatic(accepted,destination);
    await assert.rejects(cachePosters(accepted,destination,'https://addon.example/',{fetcher:async()=>new Response('',{status:503})}),/All poster sources unavailable/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
