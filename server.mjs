import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {handle,refresh} from './src/core.mjs';
import {refreshSeries} from './src/series-refresh.mjs';
const dir=new URL('./data/',import.meta.url);await mkdir(dir,{recursive:true});
const file=new URL('catalog.json',dir),tokenFile=new URL('token.txt',dir);
let token=process.env.ADDON_TOKEN;
if(!token){try{token=(await readFile(tokenFile,'utf8')).trim();}catch{token=randomBytes(24).toString('base64url');await writeFile(tokenFile,token,{mode:0o600});}}
let state={};try{state=JSON.parse(await readFile(file,'utf8'));}catch{}
const seriesFile=new URL('series.json',dir);let seriesState={};try{seriesState=JSON.parse(await readFile(seriesFile,'utf8'));}catch{}
const store={getSeries:async()=>seriesState,get:async()=>state,put:async data=>{await writeFile(new URL('catalog.json.tmp',dir),JSON.stringify(data));await rename(new URL('catalog.json.tmp',dir),file);state=data;}};
let seriesRunning=false;
async function updateSeries(){if(seriesRunning)return;seriesRunning=true;try{const next=await refreshSeries(seriesState);await writeFile(new URL('series.json.tmp',dir),JSON.stringify(next));await rename(new URL('series.json.tmp',dir),seriesFile);seriesState=next;console.log(`Verified series catalog: ${next.series.length} shows`);}catch(error){seriesState.lastError=error.message;console.error('Series refresh failed; preserving prior data:',error.message);}finally{seriesRunning=false;}}
let running=false;
async function update(){if(running)return;running=true;try{await store.put(await refresh(state));console.log(`Verified catalog: ${state.movies.length} movies; checked ${state.checkedAt}`);}catch(error){state.lastError=error.message;console.error('Refresh failed; preserving prior data:',error.message);}finally{running=false;}}
const port=Number(process.env.PORT)||7000;
const server=http.createServer(async(req,res)=>{
  try{const response=await handle(new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method}),{ADDON_TOKEN:token},store);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
  catch{res.writeHead(500);res.end('Internal error');}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Manifest: http://127.0.0.1:${port}/${token}/manifest.json`);console.log(`Status: http://127.0.0.1:${port}/${token}/status.json`);});
if(!state.checkedAt||Date.now()-Date.parse(state.checkedAt)>6*3600000)void update();
setInterval(update,6*3600000).unref();
if(!seriesState.checkedAt||Date.now()-Date.parse(seriesState.checkedAt)>6*3600000)void updateSeries();
setInterval(updateSeries,6*3600000).unref();

