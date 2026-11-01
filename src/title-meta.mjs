const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}};

export function metadataResources(items) {
  return ['movie','series'].flatMap(type=>{
    const ids=[...new Set(items.filter(x=>x.type===type&&/^tt\d+$/.test(x.id)).map(x=>x.id))];
    return ids.length?[{name:'meta',types:[type],idPrefixes:ids}]:[];
  });
}

export function titleMeta(item,raw) {
  if(raw?.id!==item.id||raw?.type!==item.type)throw Error('Title metadata identity mismatch');
  const meta={id:item.id,type:item.type,name:item.name,poster:safeUrl(item.poster||raw.poster),posterShape:'poster',
    description:[raw.description,item.description].filter(x=>typeof x==='string'&&x.trim()).join('\n\n'),
    releaseInfo:String(raw.releaseInfo||raw.year||item.releaseInfo||''),
    genres:Array.isArray(raw.genres)?raw.genres.filter(x=>typeof x==='string'):item.genres||[],
    links:item.links||[]};
  for(const key of ['background','logo']){const url=safeUrl(raw[key]);if(url)meta[key]=url;}
  for(const key of ['runtime','country','imdbRating'])if(raw[key]!=null)meta[key]=String(raw[key]);
  if(raw.released&&Number.isFinite(Date.parse(raw.released)))meta.released=new Date(raw.released).toISOString();
  for(const key of ['cast','director','writer']){
    const values=Array.isArray(raw[key])?raw[key]:raw[key]?[raw[key]]:[];
    if(values.length)meta[key]=values.filter(x=>typeof x==='string');
  }
  if(item.type==='movie')meta.behaviorHints={defaultVideoId:item.id};
  if(item.type==='series'){
    meta.videos=(raw.videos||[]).filter(v=>typeof v.id==='string'&&v.id.startsWith(item.id+':')&&Number.isInteger(v.season)&&Number.isInteger(v.episode)&&v.released&&Number.isFinite(Date.parse(v.released))).map(v=>{
      const video={id:v.id,title:String(v.title||v.name||`Episode ${v.episode}`),season:v.season,episode:v.episode,released:new Date(v.released).toISOString()};
      if(typeof v.overview==='string')video.overview=v.overview;
      if(safeUrl(v.thumbnail))video.thumbnail=safeUrl(v.thumbnail);
      return video;
    });
    if(!meta.videos.length)throw Error('Series episode metadata unavailable');
  }
  return meta;
}

export async function fetchTitleMeta(item,fetcher=fetch) {
  const response=await fetcher(`https://v3-cinemeta.strem.io/meta/${item.type}/${item.id}.json`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Title metadata HTTP '+response.status);
  const raw=(await response.json()).meta;
  titleMeta(item,raw); // Validate identity and series episodes before caching.
  return raw;
}
