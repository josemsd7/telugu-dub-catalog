import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {manifest,catalog,handle,refresh,newestFirst} from './src/core.mjs';
import {parseSource,parseMovieFacts,sourceReason,assessFilm,titleScore} from './src/source-refresh.mjs';
import {exportStatic} from './export.mjs';
import {cachePosters} from './posters.mjs';
import {discoverSources,SOURCES,SOURCE_NAME} from './src/discovery.mjs';

const stamp='2026-10-23T10:00:00Z';
const row={title:'Mandaadi',ottReleaseDate:'2026-10-08',dateText:'08th Oct 2026',languageText:'Tamil to Telugu',genreText:'Action Drama',castText:'Soori, Suhas, Mahima Nambiar',platforms:['Netflix'],sourceUrl:'https://ottreleasemovies.com/',sourceRank:0,tentative:false};
const meta={id:'tt36596965',name:'Mandaadi',type:'movie',countries:['india'],cast:['Soori','Suhas'],directors:[],year:'2026',tmdbId:'1465943'};
const match={row,meta,titleScore:100,castMatches:2};
const identity={items:['Q134704471'],names:['mandaadi'],countries:['Q668'],languages:[],tmdbIds:['1465943'],checkedAt:stamp};
const movie={id:meta.id,type:'movie',name:meta.name,releaseInfo:'2026',ottReleaseDate:'2026-10-08',genres:['Tamil'],originalLanguageIds:['Q5885'],poster:'https://images.metahub.space/poster/small/tt36596965/img',posterCandidates:['https://images.metahub.space/poster/small/tt36596965/img'],platforms:['Netflix']};
const accepted={checkedAt:stamp,movies:[movie],sortOrder:'source_ott_release_date_desc',sourceName:'OTTReleaseMovies'};
const html='<table><tr><th>Movie/ Series</th><th>OTT Release Date</th><th>OTT Platform</th><th>Genre</th><th>Direct/ Dubbing?</th><th>Lead Roles</th></tr><tr><td><a href="https://ottreleasemovies.com/mandaadi/">Mandaadi</a></td><td>08th Oct 2026</td><td><img src="/netflix-logo-new.png"></td><td>Action Drama</td><td>Tamil to Telugu</td><td>Soori, Suhas</td></tr></table>';
const moviePage=(name='Mandaadi',language='Tamil',id='1465943')=>`<link rel="canonical" href="https://www.themoviedb.org/movie/${id}"><meta property="og:title" content="${name}"><p><strong><bdi>Original Language</bdi></strong> ${language}</p>`;
const trendHtml='<table><tr><th>Movie</th><th>Digital Release Date</th><th>Online Streaming Partner</th><th>Category</th></tr><tr><td>Dhoomakethu (Telugu)</td><td>23 Oct 2026</td><td>Netflix &amp; Prime Video</td><td>Film</td></tr><tr><td>Example Show</td><td>Soon</td><td>Zee5</td><td>Series</td></tr></table>';
const sacHtml=(date='Oct 16, 2026',title='Aasha')=>`<div id="ottReleasesContainer"><a href="/movie/${title}_2026" data-platforms="Zee5" data-languages="Malayalam, Telugu"><img alt="${title}"><div>${date}</div><h3 title="${title}">${title}</h3></a></div><a href="?type=recent&amp;page=25">25</a>`;

test('public HTML parser extracts OTT dates, dubbing direction, platform and source link',()=>{
  const parsed=parseSource(html);assert.equal(parsed.sourceRowCount,1);
  assert.equal(parsed.rows[0].ottReleaseDate,'2026-10-08');
  assert.deepEqual(parsed.rows[0].platforms,['Netflix']);
  assert.equal(parsed.rows[0].languageText,'Tamil to Telugu');
  assert.equal(parsed.rows[0].sourceUrl,'https://ottreleasemovies.com/mandaadi/');
  assert.throws(()=>parseSource('<html>No table</html>'),/Release parser failed/);
});
test('additional parsers read Telugu availability without treating it as the original language',()=>{
  const trend=parseSource(trendHtml,'trendraja');
  assert.equal(trend.rows[0].ottReleaseDate,'2026-10-23');
  assert.deepEqual(trend.rows[0].platforms,['Netflix','Prime Video']);
  assert.equal(trend.rows[0].languageText,'Telugu');
  assert.equal(sourceReason(trend.rows[1],'2026-10-23'),'missing_ott_date');
  const sac=parseSource(sacHtml(),'sacnilk');
  assert.equal(sac.totalPages,25);assert.equal(sac.rows[0].movieYearHint,'2026');
  assert.deepEqual(sac.rows[0].platforms,['ZEE5']);
  assert.equal(sac.rows[0].languageText,'Malayalam, Telugu');
  assert.throws(()=>parseSource('<h1>No cards</h1>','sacnilk'),/parser failed/);
});
test('one failed source retains its snapshot while another updates',async()=>{
  const old={sourceSnapshots:{trendraja:{checkedAt:stamp,rows:[{...row,title:'Cached film'}]}}};
  const result=await discoverSources(old,{now:Date.parse(stamp),sources:SOURCES.slice(0,2),parsePage:parseSource,fetcher:async url=>url.includes('trendraja')?new Response('',{status:503}):new Response(html)});
  assert.equal(result.statuses[0].state,'ok');assert.equal(result.statuses[1].state,'cached');
  assert.equal(result.rows.length,2);assert.equal(result.windowStart,'2025-10-23');
  assert.equal(result.rows.find(x=>x.title==='Cached film').sourceName,'Trendraja');
  await assert.rejects(discoverSources(old,{now:Date.parse(stamp),sources:SOURCES.slice(0,2),parsePage:parseSource,fetcher:async()=>new Response('',{status:503})}),/All release sources failed/);
});
test('Sacnilk pagination follows public links and stops after the recent window',async()=>{
  const requests=[];
  const fetcher=async url=>{requests.push(url);return new Response(sacHtml(url.includes('page=')?'Oct 16, 2024':'Oct 16, 2026',url.includes('page=')?'Older':'Aasha'));};
  const result=await discoverSources({},{now:Date.parse(stamp),sources:[SOURCES[2]],parsePage:parseSource,fetcher});
  assert.equal(requests.length,3);assert.equal(result.rows.length,1);assert.equal(result.statuses[0].pagesFetched,3);
});
test('partial pagination preserves rows from a missing page and reports the failure',async()=>{
  const previous={sourceSnapshots:{sacnilk:{checkedAt:stamp,rows:[{...row,title:'Previous page film',sourceName:'Sacnilk'}]}}};
  const fetcher=async url=>url.includes('page=2')?new Response('',{status:503}):new Response(sacHtml(url.includes('page=')?'Oct 16, 2024':'Oct 16, 2026'));
  const result=await discoverSources(previous,{now:Date.parse(stamp),sources:[SOURCES[2]],parsePage:parseSource,fetcher});
  assert.equal(result.statuses[0].state,'partial');assert.equal(result.rows.length,2);
  assert.match(result.statuses[0].errors[0],/Page 2: HTTP 503/);
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
test('public movie facts require one explicit language and the requested canonical movie ID',()=>{
  const facts=parseMovieFacts(moviePage(),meta.tmdbId);
  assert.deepEqual(facts.languageIds,['Q5885']);
  assert.deepEqual(parseMovieFacts(moviePage().replace('/1465943"','/1465943-mandaadi"'),meta.tmdbId).languageIds,['Q5885']);
  assert.throws(()=>parseMovieFacts(moviePage(),123),/ID mismatch/);
  assert.throws(()=>parseMovieFacts(moviePage().replace('Original Language','Spoken Languages'),meta.tmdbId),/unambiguous/);
  assert.throws(()=>parseMovieFacts(moviePage()+'<p>Original Language Telugu</p>',meta.tmdbId),/unambiguous/);
  assert.throws(()=>parseMovieFacts(moviePage('Mandaadi','Tamil, Telugu'),meta.tmdbId),/Unrecognized/);
});
test('independent public facts admit generic multilingual dubs and reject Telugu originals or conflicts',()=>{
  const generic={...row,languageText:'Telugu, Tamil'};
  const facts=parseMovieFacts(moviePage(),meta.tmdbId);
  assert.equal(assessFilm(generic,match,identity,facts).reason,null);
  assert.match(assessFilm(generic,match,identity,facts).originalEvidence,/TMDB/);
  assert.equal(assessFilm(generic,match,identity,{...facts,languageIds:['Q8097']}).reason,'original_telugu');
  assert.equal(assessFilm(row,match,identity,{...facts,languageIds:['Q1568']}).reason,'original_language_conflict');
  assert.equal(assessFilm(row,match,identity,{...facts,title:'Different Film'}).reason,'original_language_identity_conflict');
  assert.equal(assessFilm(row,{...match,meta:{...meta,name:'Modha Rathiri'}},identity,{...facts,title:'Modha Rathri'}).reason,null);
});
test('structured country facts must belong to the same public movie page',()=>{
  const structured={"@type":"Movie",url:'https://www.themoviedb.org/movie/1465943',countryOfOrigin:[{"@type":"Country",name:'India'}],image:'https://image.tmdb.org/t/p/w500/poster.jpg'};
  const page=moviePage()+'<script type="application/ld+json">/* <![CDATA[ */'+JSON.stringify(structured)+'/* ]]> */</script>';
  const facts=parseMovieFacts(page,meta.tmdbId);
  assert.deepEqual(facts.countries,['india']);assert.equal(facts.poster,'https://image.tmdb.org/t/p/w342/poster.jpg');
  const unknown={...match,meta:{...meta,countries:[]}},noCountry={...identity,countries:[]};
  assert.equal(assessFilm(row,unknown,noCountry,{...facts,countries:[]}).reason,'indian_origin_unconfirmed');
  assert.equal(assessFilm(row,unknown,noCountry,facts).reason,null);
  assert.match(assessFilm(row,unknown,noCountry,facts).countryEvidence,/TMDB/);
  assert.equal(assessFilm(row,match,identity,{...facts,countries:['united states']}).reason,'country_conflict');
  const wrongPage=moviePage()+'<script type="application/ld+json">'+JSON.stringify({...structured,url:'https://www.themoviedb.org/movie/999'})+'</script>';
  assert.deepEqual(parseMovieFacts(wrongPage,meta.tmdbId).countries,[]);
});
test('foreign productions and mismatched cast cannot enter the catalog',()=>{
  assert.equal(assessFilm(row,{...match,meta:{...meta,countries:['united states']}},identity).reason,'non_indian_film');
  assert.equal(assessFilm(row,{...match,castMatches:0},identity).reason,'cast_mismatch');
  assert.equal(titleScore('Makutam','Magudam'),90);
  assert.equal(titleScore('Mandaadi','Mardaani'),0);
  assert.equal(titleScore('Example Local Title (Original Name)','Original Name'),100);
  assert.equal(titleScore('The India Story: Slow Poison in Progress','The India Story'),80);
  assert.equal(titleScore('Vishwanath & Sons','Vishwanath and Sons'),100);
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
  await assert.rejects(refresh(accepted,{fetcher:async()=>new Response('',{status:503})}),/All release sources failed/);
  assert.equal(accepted.movies.length,1);
});
test('the full refresh matches a source row, resolves the film and uses its OTT date',async()=>{
  const fetcher=async url=>{
    const value=String(url);
    if(value==='https://ottreleasemovies.com/')return new Response(html);
    if(value.includes('/catalog/'))return Response.json({metas:[{id:meta.id,type:'movie',name:meta.name,releaseInfo:'2026'}]});
    if(value.includes('/meta/'))return Response.json({meta:{id:meta.id,type:'movie',name:meta.name,country:'India',cast:['Soori'],moviedb_id:1465943,releaseInfo:'2026',released:'2026-09-10'}});
    if(value.includes('themoviedb.org/movie/'))return new Response(moviePage());
    throw Error('Unexpected network request');
  };
  const result=await refresh({identities:{[meta.id]:identity}},{source:parseSource(html),fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(result.movies[0].ottReleaseDate,'2026-10-08');
  assert.equal(result.sourceName,SOURCE_NAME);assert.equal(result.sortOrder,'source_ott_release_date_desc');
});
test('a generic multilingual row uses cached original facts without another page fetch',async()=>{
  const previous={identities:{[meta.id]:identity},sourceOriginalLanguageCache:{[meta.tmdbId]:{...parseMovieFacts(moviePage(),meta.tmdbId),checkedAt:stamp}}};
  const fetcher=async url=>{
    if(String(url).includes('/catalog/'))return Response.json({metas:[{id:meta.id,name:meta.name}]});
    if(String(url).includes('/meta/'))return Response.json({meta:{id:meta.id,name:meta.name,country:'India',cast:['Soori'],moviedb_id:1465943,releaseInfo:'2026'}});
    throw Error('Unexpected page fetch');
  };
  const result=await refresh(previous,{source:{rows:[{...row,languageText:'Tamil, Telugu'}]},fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.match(result.movies[0].originalLanguageEvidence,/TMDB/);
  assert.deepEqual(result.refreshWarnings,[]);
});
test('a recent failed metadata request is cached briefly and retried after expiry',async()=>{
  const positive={...identity,languages:['Q5885']};
  const previous={checkedAt:stamp,refreshWarnings:[meta.id+': Metadata HTTP 504'],identities:{[meta.id]:positive},sourceSearchCache:{mandaadi:{hits:[{id:meta.id,name:meta.name,year:'2026'}],checkedAt:stamp}}};
  let calls=0;
  const fetcher=async url=>{if(String(url).includes('/meta/')){calls++;return Response.json({meta:{id:meta.id,name:meta.name,country:'India',cast:['Soori'],moviedb_id:meta.tmdbId,releaseInfo:'2026'}});}throw Error('Unexpected request');};
  const source={rows:[row]};
  const result=await refresh(previous,{source,fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(calls,0);assert.match(result.refreshWarnings[0],/Cached lookup failure/);
  await refresh(previous,{source,fetcher,now:Date.parse(stamp)+2*3600000});assert.equal(calls,1);
});
test('multiple publishers merge one film, preserve provenance and use its earliest reported date',async()=>{
  const previous={identities:{[meta.id]:identity},sourceMetadataCache:{[meta.id]:{...meta,checkedAt:stamp}},sourceOriginalLanguageCache:{[meta.tmdbId]:{...parseMovieFacts(moviePage(),meta.tmdbId),checkedAt:stamp}}};
  const rows=[{...row,sourceName:'OTTReleaseMovies'}, {...row,sourceName:'Sacnilk',languageText:'Tamil, Telugu',ottReleaseDate:'2026-10-07',platforms:['Netflix','Prime Video'],sourceUrl:'https://www.sacnilk.com/movie/Mandaadi_2026'}, {...row,sourceName:'Sacnilk',ottReleaseDate:'2026-10-07',platforms:['ETV Win'],sourceUrl:'https://www.sacnilk.com/movie/Mandaadi_2026'}];
  const fetcher=async()=>Response.json({metas:[{id:meta.id,name:meta.name}]});
  const result=await refresh(previous,{source:{rows},fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(result.duplicatesMerged,2);
  const m=result.movies[0];assert.equal(m.ottReleaseDate,'2026-10-07');
  assert.deepEqual(new Set(m.sourceNames),new Set(['Sacnilk','OTTReleaseMovies']));
  assert.deepEqual(m.releaseDateConflicts,[{platform:'Netflix',dates:['2026-10-07','2026-10-08']}]);
  assert.deepEqual(new Set(m.platforms),new Set(['Netflix','Prime Video','ETV Win']));
  assert.equal(m.releaseListings.length,2);assert.ok(m.releaseListings.find(x=>x.sourceName==='Sacnilk').platforms.includes('ETV Win'));
  assert.equal('releaseListings' in catalog(result).metas[0],false);
});
test('a publisher movie-year hint cannot match a different-year film',async()=>{
  const previous={identities:{[meta.id]:identity},sourceMetadataCache:{[meta.id]:{...meta,checkedAt:stamp}},sourceOriginalLanguageCache:{[meta.tmdbId]:{...parseMovieFacts(moviePage(),meta.tmdbId),checkedAt:stamp}}};
  const fetcher=async()=>Response.json({metas:[{id:meta.id,name:meta.name}]});
  const result=await refresh(previous,{source:{rows:[{...row,movieYearHint:'2025'},row]},fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(result.counts.no_matching_movie_id,1);
});
test('a year hint keeps a valid fourth search hit from being hidden by older namesakes',async()=>{
  const previous={identities:{[meta.id]:identity},sourceMetadataCache:{[meta.id]:{...meta,checkedAt:stamp}},sourceOriginalLanguageCache:{[meta.tmdbId]:{...parseMovieFacts(moviePage(),meta.tmdbId),checkedAt:stamp}}};
  const fetcher=async()=>Response.json({metas:[...['tt100','tt101','tt102'].map(id=>({id,name:meta.name,releaseInfo:'2025'})),{id:meta.id,name:meta.name,releaseInfo:'2026'}]});
  const result=await refresh(previous,{source:{rows:[{...row,movieYearHint:'2026'}]},fetcher,now:Date.parse(stamp)});
  assert.equal(result.movies.length,1);assert.equal(result.movies[0].id,meta.id);
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
