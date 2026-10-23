import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {catalog,manifest,status} from './src/core.mjs';

export async function exportStatic(data,destination=new URL('./public/',import.meta.url)) {
  if(!data.movies?.length)throw new Error('Refusing to export an empty catalog');
  await rm(destination,{recursive:true,force:true});
  const route=new URL('catalog/movie/telugu-dubbed/',destination);
  await mkdir(route,{recursive:true});
  const save=(name,body)=>writeFile(new URL(name,destination),JSON.stringify(body));
  const info=manifest();
  // Static hosting supports browse and pagination. Do not advertise dynamic search.
  info.catalogs[0].extra=[{name:'skip'}];
  await save('manifest.json',info);
  const {stale,...snapshotStatus}=status(data);
  await save('status.json',{...snapshotStatus,staleAfter:new Date(Date.parse(data.checkedAt)+6*3600000).toISOString()});
  await save('catalog/movie/telugu-dubbed.json',catalog(data));
  for(let skip=0;skip<=Math.ceil(data.movies.length/100)*100;skip+=100)
    await save(`catalog/movie/telugu-dubbed/skip=${skip}.json`,catalog(data,`skip=${skip}`));
  await writeFile(new URL('.nojekyll',destination),'');
  await writeFile(new URL('index.html',destination),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Telugu Dubs — Digital Catalog</title><style>body{font:18px/1.6 system-ui;max-width:700px;margin:4rem auto;padding:0 1.5rem;color:#17242b}button{font:inherit;padding:.7rem 1rem}input{width:95%;padding:.5rem;font:14px monospace}small{display:block;margin:1rem 0;color:#52636b}</style><h1>Telugu Dubs — Digital Catalog</h1><p>${data.movies.length} Indian films indexed with Telugu audio. Films listed as originally Telugu are excluded.</p><p><b>Order: newest film release date first.</b> Release year is used when the date is missing. Exact Telugu OTT premiere dates are unavailable. Telugu audio is reported by MediaFusion's release index; this add-on does not inspect video tracks.</p><p>Metadata checked: ${data.checkedAt}. Automatic updates are scheduled every six hours; jobs can be delayed.</p><button id="install">Install in Stremio</button><p><input id="link" readonly aria-label="Stremio manifest URL"></p><small>Catalog only. No playback, provider login, debrid, or API key. Sources: <a href="https://github.com/mhdzumair/MediaFusion">MediaFusion</a>, <a href="https://www.wikidata.org">Wikidata</a>, and <a href="https://v3-cinemeta.strem.io">Cinemeta</a>. <a href="status.json">Coverage and checks</a>.</small><script>const u=new URL('manifest.json',location.href);document.getElementById('link').value=u.href;document.getElementById('install').onclick=()=>location.href='stremio://'+u.host+u.pathname;</script></html>`);
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const data=JSON.parse(await readFile(new URL('./data/catalog.json',import.meta.url),'utf8'));
  await exportStatic(data);
  console.log(`Exported ${data.movies.length} movies to public/`);
}
