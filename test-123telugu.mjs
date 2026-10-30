import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSource,sourceReason,refreshFromOtt,titleScore} from './src/source-refresh.mjs';
import {discoverSources,SOURCES} from './src/discovery.mjs';
import {seriesSourceReason} from './src/series-refresh.mjs';
import {parseProviderFacts,enrichProviderRows} from './src/provider-facts.mjs';

const ott=(rows)=>`<div class="t123-tab-content t123-show-Theatrical"><table><tr><td>Theater-only movie</td><td>Oct 30</td></tr></table></div><div class="t123-tab-content t123-show-OTT"><table class="t123-table">${rows}</table></div>`;
const row=(title='Sigma',label='Tamil Film - Telugu Dub',day='Oct 30')=>`<tr><td><a href="https://www.netflix.com/in/title/82775969">${title} (${label})</a> Netflix</td><td>${day}</td></tr>`;
const provider=(type='Movie',id='82775969',title='Sigma')=>`<script type="application/ld+json">${JSON.stringify({'@type':type,url:`https://www.netflix.com/in/title/${id}`,name:title,actors:[{'@type':'Person',name:'Sundeep Kishan'},{'@type':'Person',name:'Faria Abdullah'}],directors:[{'@type':'Person',name:'Jason Sanjay'}]})}</script>`;
const providerUrl='https://www.netflix.com/in/title/82775969';

test('123telugu reads only the OTT tab, preserves dubbing direction and separates shows',()=>{
  const result=parseSource(ott(row()+row('Local','Telugu Film')+row('Show S1','Hindi Series - Telugu Dub')+row('Hindi only','Hindi Film')),'123telugu','2026-10-29');
  assert.equal(result.rows.length,4);assert.equal(result.rows.some(x=>x.title==='Theater-only movie'),false);
  const [dub,original,show,noAudio]=result.rows;
  assert.equal(dub.title,'Sigma');assert.equal(dub.languageText,'Tamil to Telugu');assert.equal(dub.ottReleaseDate,'2026-10-30');assert.equal(dub.dateYearInferred,true);assert.equal(dub.providerUrl,providerUrl);
  assert.equal(sourceReason(dub,'2026-10-29'),'upcoming');
  assert.equal(sourceReason(original,'2026-10-30'),'original_telugu');
  assert.equal(sourceReason(show,'2026-10-30'),'not_a_movie');assert.equal(seriesSourceReason(show,'2026-10-30'),null);
  assert.equal(sourceReason(noAudio,'2026-10-30'),'telugu_audio_not_listed');
  assert.throws(()=>parseSource('<table>'+row()+'</table>','123telugu','2026-10-29'),/parser failed/);
});

test('month/day schedules resolve the adjacent year across New Year and retain the inference',()=>{
  assert.equal(parseSource(ott(row('January movie','Tamil Film - Telugu Dub','Jan 2')),'123telugu','2026-12-30').rows[0].ottReleaseDate,'2027-01-02');
  assert.equal(parseSource(ott(row('December movie','Tamil Film - Telugu Dub','Dec 30')),'123telugu','2027-01-02').rows[0].ottReleaseDate,'2026-12-30');
});

test('linked Netflix facts must match both the exact title ID and media type',()=>{
  assert.equal(parseProviderFacts(provider(),providerUrl).cast.includes('Sundeep Kishan'),true);
  assert.throws(()=>parseProviderFacts(provider('Movie','99999999'),providerUrl),/unavailable or conflicting/);
  assert.throws(()=>parseProviderFacts(provider('TVSeries'),providerUrl),/unavailable or conflicting/);
  assert.throws(()=>parseProviderFacts(provider(),providerUrl,'TVSeries'),/unavailable or conflicting/);
  assert.throws(()=>parseProviderFacts(provider(),'https://unrelated.example/title/82775969'),/Unsupported/);
});

test('publisher dubbing labels and linked cast resolve the correct Sigma and remain automatic on refresh',async()=>{
  const now=Date.parse('2026-10-30T01:00:00Z'),checkedAt=new Date(now).toISOString();
  const target={id:'tt123456',name:'Sigma',type:'movie',year:'2026',countries:['india'],cast:['Sundeep Kishan','Faria Abdullah'],directors:['Jason Sanjay'],tmdbId:null,checkedAt};
  const namesake={...target,id:'tt999999',year:'2024',cast:['Other Actor'],directors:[]};
  const empty={items:[],languages:[],countries:[],tmdbIds:[],checkedAt};
  const previous={identities:{[target.id]:empty,[namesake.id]:empty},sourceMetadataCache:{[target.id]:target,[namesake.id]:namesake},sourceSearchCache:{sigma:{hits:[namesake,target],checkedAt}}};
  const source=parseSource(ott(row()),'123telugu','2026-10-30');source.rows[0].sourceName='123telugu';
  let calls=0;
  const fetcher=async url=>{assert.equal(url,providerUrl);calls++;return new Response(provider());};
  const first=await refreshFromOtt(previous,{source,fetcher,now});
  assert.equal(first.movies.length,1);assert.equal(first.movies[0].id,target.id);assert.deepEqual(first.movies[0].originalLanguageIds,['Q5885']);
  assert.equal(first.movies[0].releaseListings[0].dateYearInferred,true);assert.ok(first.movies[0].links.some(x=>x.url===providerUrl));
  const second=await refreshFromOtt(first,{source,fetcher,now:now+1000});
  assert.equal(second.movies[0].id,target.id);assert.equal(calls,1);
  const rejected=await enrichProviderRows(source.rows,{}, {fetcher:async()=>new Response(provider('Movie','82775969','Different title')),now,titleScore});
  assert.equal(rejected.rows[0].castText,'');
});

test('rotating OTT windows retain seen releases and replace a corrected schedule',async()=>{
  const source=SOURCES.find(x=>x.key==='123telugu');
  const previous={sourceSnapshots:{'123telugu':{checkedAt:'2026-10-29T00:00:00Z',rows:[{title:'Previously seen',ottReleaseDate:'2026-10-23',platforms:['Netflix']},{title:'Sigma',ottReleaseDate:'2026-10-29',platforms:['Netflix']}]}}};
  const result=await discoverSources(previous,{sources:[source],parsePage:parseSource,now:Date.parse('2026-10-30T00:00:00Z'),fetcher:async()=>new Response(ott(row()))});
  assert.equal(result.rows.length,2);assert.equal(result.rows.find(x=>x.title==='Sigma').ottReleaseDate,'2026-10-30');
  assert.equal(result.statuses[0].rawRowCount,1);assert.equal(result.statuses[0].rowCount,2);
});
