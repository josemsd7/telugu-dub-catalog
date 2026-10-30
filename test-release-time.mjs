import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indiaDate,RELEASE_TIME_ZONE} from './src/release-time.mjs';
import {refreshFromOtt} from './src/source-refresh.mjs';
import {refreshSeries} from './src/series-refresh.mjs';
import {discoverSources,SOURCES} from './src/discovery.mjs';
import {parseSource} from './src/source-refresh.mjs';

test('India changes release day at 18:30 UTC, including New Year',()=>{
  assert.equal(RELEASE_TIME_ZONE,'Asia/Kolkata');
  assert.equal(indiaDate('2026-10-29T18:29:59.999Z'),'2026-10-29');
  assert.equal(indiaDate('2026-10-29T18:30:00.000Z'),'2026-10-30');
  assert.equal(indiaDate('2026-12-31T18:30:00Z'),'2027-01-01');
  assert.equal(indiaDate('invalid'),null);
});

test('October 30 movies enter at India midnight while UTC is still October 29',async()=>{
  const before=Date.parse('2026-10-29T18:29:59Z'),checkedAt=new Date(before).toISOString();
  const make=(id,name,day)=>({row:{title:name,ottReleaseDate:day,languageText:'Tamil to Telugu',genreText:'Movie',castText:'Actor One',platforms:['Netflix'],sourceUrl:'https://example.org/releases'},meta:{id,name,type:'movie',year:'2026',countries:['india'],cast:['Actor One'],directors:[],tmdbId:null,checkedAt}});
  const items=[make('tt123456','Earlier','2026-10-28'),make('tt234567','India midnight','2026-10-30')];
  const identity={items:['Q123'],countries:['Q668'],languages:['Q5885'],tmdbIds:[],checkedAt};
  const previous={sourceSearchCache:Object.fromEntries(items.map(x=>[x.meta.name.toLowerCase().replaceAll(' ',''),{hits:[x.meta],checkedAt}])),sourceMetadataCache:Object.fromEntries(items.map(x=>[x.meta.id,x.meta])),identities:Object.fromEntries(items.map(x=>[x.meta.id,identity]))};
  const options={source:{rows:items.map(x=>x.row)},fetcher:async()=>{throw Error('Unexpected request');}};
  const first=await refreshFromOtt(previous,{...options,now:before});
  assert.equal(first.movies.length,1);assert.equal(first.counts.upcoming,1);
  const second=await refreshFromOtt(previous,{...options,now:before+1000});
  assert.deepEqual(second.movies.map(x=>x.id),['tt234567','tt123456']);
  assert.equal(second.releaseTimeZone,'Asia/Kolkata');
  assert.equal(second.checkedAt,'2026-10-29T18:30:00.000Z');
});

test('series release eligibility and aired episode labels use the Indian calendar',async()=>{
  const before=Date.parse('2026-10-29T18:29:59Z'),checkedAt=new Date(before).toISOString();
  const id='tt345678';
  const previous={searchCache:{show:{hits:[{id,name:'Show'}],checkedAt}},identities:{[id]:{items:['Q123'],countries:['Q668'],languages:['Q1568'],tmdbIds:[],checkedAt}}};
  const row={title:'Show',season:1,ottReleaseDate:'2026-10-30',languageText:'Hindi to Telugu',genreText:'Series',castText:'Actor One',platforms:['Netflix'],sourceUrl:'https://example.org/releases'};
  const options={source:{rows:[row]},fetcher:async url=>{
    assert.match(url,/\/meta\/series\/tt345678\.json$/);
    return Response.json({meta:{id,name:'Show',type:'series',country:'India',cast:['Actor One'],releaseInfo:'2026',videos:[{season:1,released:'2026-10-29T19:00:00Z'},{season:1,released:'2026-10-30T19:00:00Z'}]}});
  }};
  await assert.rejects(refreshSeries(previous,{...options,now:before}),/No verified series/);
  const after=await refreshSeries(previous,{...options,now:Date.parse('2026-10-29T20:00:00Z')});
  assert.equal(after.series.length,1);assert.equal(after.releaseTimeZone,'Asia/Kolkata');
  assert.equal(after.series[0].latestAiredDate,'2026-10-30');
  assert.equal(after.metadataCache[id].seasonLatestDates[1],'2026-10-30');
});

test('source year inference and coverage windows receive the Indian day',async()=>{
  const source=SOURCES.find(x=>x.key==='123telugu');
  const html='<div class="t123-show-OTT"><table><tr><td>New Year (Tamil Film - Telugu Dub) Netflix</td><td>Jan 1</td></tr></table></div>';
  let reference;
  const result=await discoverSources({}, {now:Date.parse('2026-12-31T18:30:00Z'),sources:[source],parsePage:(html,kind,day)=>{reference=day;return parseSource(html,kind,day);},fetcher:async()=>new Response(html)});
  assert.equal(reference,'2027-01-01');assert.equal(result.rows[0].ottReleaseDate,'2027-01-01');assert.equal(result.windowStart,'2026-01-01');
});

test('the six-hour workflow includes midnight in India',async()=>{
  const workflow=await readFile(new URL('./.github/workflows/catalog.yml',import.meta.url),'utf8');
  assert.match(workflow,/cron: '30 0,6,12,18 \* \* \*'/);
  const hours=[0,6,12,18].map(hour=>new Intl.DateTimeFormat('en-GB',{timeZone:RELEASE_TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.UTC(2026,9,29,hour,30)))).sort();
  assert.deepEqual(hours,['00:00','06:00','12:00','18:00']);
});
