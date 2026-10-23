import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {wikiReason,canonicalReason,assemble,manifest,catalog,handle,refresh} from './src/core.mjs';
import {exportStatic} from './export.mjs';

const stamp='2026-10-23T10:00:00Z';
const item={id:'tt1234567',name:'Example',releaseInfo:'2025',sourceCatalog:'telugu_dubbed',sourceRank:0};
const identity={items:['Q123'],names:['example'],countries:['Q668'],languages:['Q5885'],tmdbIds:['123'],checkedAt:stamp};
const canonical={name:'Example',countries:['india'],tmdbId:'123',year:'2025',checkedAt:stamp};
const accepted=assemble([item],{[item.id]:identity},{[item.id]:canonical},stamp);

test('accepts independently matched Indian non-Telugu originals',()=>{
  assert.equal(accepted.movies.length,1);
  assert.equal(accepted.movies[0].genres[0],'Tamil');
});
test('excludes original Telugu even when another original language exists',()=>{
  assert.equal(wikiReason(item,{...identity,languages:['Q5885','Q8097']}),'original_telugu');
});
test('fails closed on missing or conflicting film identities',()=>{
  assert.equal(wikiReason(item,{...identity,languages:[]}),'missing_original_language');
  assert.equal(wikiReason(item,{...identity,countries:['Q30']}),'not_confirmed_indian');
  assert.equal(wikiReason(item,{...identity,items:['Q123','Q124']}),'ambiguous_identity');
  assert.equal(wikiReason({...item,name:'Different'},identity),'title_mismatch');
  assert.equal(canonicalReason(item,identity,{...canonical,countries:['united states']}),'canonical_country_mismatch');
  assert.equal(canonicalReason(item,identity,{...canonical,tmdbId:'999'}),'canonical_tmdb_mismatch');
});
test('manifest exposes only a movie catalog',()=>{
  assert.deepEqual(manifest().resources,['catalog']);
  assert.deepEqual(manifest().types,['movie']);
});
test('catalog paginates and searches, strips audit fields, rejects invalid offsets',()=>{
  const movies=Array.from({length:173},(_,i)=>({...accepted.movies[0],id:'tt'+(1000000+i),name:'Film '+i}));
  assert.equal(catalog({movies}).metas.length,100);
  assert.equal(catalog({movies},'skip=100').metas.length,73);
  assert.equal(catalog({movies},'search=Film%2072').metas[0].name,'Film 72');
  assert.equal(catalog({movies},'genre=Hindi').metas.length,0);
  assert.equal('wikidata' in catalog({movies}).metas[0],false);
  assert.throws(()=>catalog({movies},'skip=-1'));
});
test('HTTP routes protect token and do not implement streams',async()=>{
  const token='testing_token_01234567890123456789',env={ADDON_TOKEN:token},store={get:async()=>accepted};
  const request=path=>handle(new Request('https://addon.invalid'+path),env,store);
  assert.equal((await request('/manifest.json')).status,404);
  assert.equal((await request('/'+token+'/stream/movie/tt1234567.json')).status,404);
  const response=await request('/'+token+'/catalog/movie/telugu-dubbed.json');
  assert.equal(response.status,200);
  assert.equal((await response.json()).metas.length,1);
});
test('a failed refresh rejects without mutating the previous catalog',async()=>{
  await assert.rejects(refresh(accepted,{fetcher:async()=>new Response('',{status:503})}),/503/);
  assert.equal(accepted.movies.length,1);
});
test('one unavailable independent metadata service does not erase other verified films',async()=>{
  const other={...item,id:'tt7654321'};
  const fakeFetch=async url=>{
    if(String(url).includes('mediafusion.'))return Response.json({metas:[item,other]});
    if(String(url).includes(other.id))return new Response('',{status:504});
    return Response.json({meta:{id:item.id,name:'Example',country:'India',moviedb_id:123,releaseInfo:'2025'}});
  };
  const result=await refresh({identities:{[item.id]:identity,[other.id]:identity}}, {pages:1,fetcher:fakeFetch,now:Date.parse(stamp),maxNew:10});
  assert.equal(result.movies.length,1);
  assert.equal(result.refreshWarnings.length,1);
});

test('static hosting exports only supported routes with all 75 supplied films',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'telugu-dub-test-'));
  try {
    const data={...accepted,movies:Array.from({length:75},(_,i)=>({...accepted.movies[0],id:'tt'+(1000000+i)}))};
    await exportStatic(data,pathToFileURL(directory+'/'));
    const info=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
    assert.deepEqual(info.resources,['catalog']);
    assert.deepEqual(info.catalogs[0].extra,[{name:'skip'}]);
    assert.equal(JSON.parse(await readFile(join(directory,'catalog/movie/telugu-dubbed.json'),'utf8')).metas.length,75);
    assert.equal(JSON.parse(await readFile(join(directory,'catalog/movie/telugu-dubbed/skip=100.json'),'utf8')).metas.length,0);
    const status=JSON.parse(await readFile(join(directory,'status.json'),'utf8'));
    assert.equal(status.staleAfter,'2026-10-23T16:00:00.000Z');
    assert.equal('stale' in status,false);
  } finally {await rm(directory,{recursive:true,force:true});}
});
