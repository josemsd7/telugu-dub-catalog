export const VERSION = '0.4.0';
export const LANGUAGES = {Q5885:'Tamil',Q1568:'Hindi',Q36236:'Malayalam',Q33673:'Kannada',Q5146:'Punjabi',Q9610:'Bengali',Q1571:'Marathi',Q33810:'Odia',Q1860:'English'};
const UA = 'TeluguDubCatalog/0.1 (personal non-commercial catalog metadata; no playback requests)';
const MAX_AGE = 6 * 60 * 60 * 1000;
export const normalize = value => String(value || '').replace(/\s*\((?:telugu|tamil|hindi|malayalam|kannada)(?:\s+version)?\)\s*/gi,'').replace(/&/g,' and ').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const tail = value => String(value || '').split('/').pop();
const yearOf = value => String(value || '').match(/\d{4}/)?.[0] || null;
const plain = (value,max=300) => String(value || '').slice(0,max);

export async function jsonFetch(url, fetcher=fetch) {
  const response = await fetcher(url, {headers:{Accept:'application/json', 'User-Agent':UA}, signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Metadata source returned HTTP ${response.status}`);
  return response.json();
}

export async function parallelMap(values, concurrency, work) {
  const results = new Array(values.length); let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{
    for (;;) {const i=next++; if(i>=values.length)return;results[i]=await work(values[i],i);}
  })); return results;
}

export function wikiQuery(ids) {
  if (!ids.length || ids.some(id=>!/^tt\d+$/.test(id))) throw new Error('Invalid IMDb identifiers');
  return `SELECT ?item ?itemLabel ?imdb ?lang ?country ?tmdb (MIN(?pub) AS ?date) (GROUP_CONCAT(DISTINCT ?alias; separator="|||") AS ?aliases) WHERE {
 VALUES ?imdb { ${ids.map(id=>'"'+id+'"').join(' ')} }
 ?item wdt:P345 ?imdb.
 OPTIONAL { ?item wdt:P364 ?lang. }
 OPTIONAL { ?item wdt:P495 ?country. }
 OPTIONAL { ?item wdt:P4947 ?tmdb. }
 OPTIONAL { ?item wdt:P577 ?pub. }
 OPTIONAL { ?item skos:altLabel ?alias. FILTER(LANG(?alias)="en") }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?imdb ?lang ?country ?tmdb`;
}

export function wikiRecords(rows, checkedAt) {
  const records={};
  for(const row of rows) {
    const id=row.imdb?.value; if(!/^tt\d+$/.test(id||''))continue;
    const r=records[id] ||= {items:[],names:[],languages:[],countries:[],tmdbIds:[],years:[],checkedAt};
    for(const [key,value] of [['items',tail(row.item?.value)],['names',normalize(row.itemLabel?.value)],['languages',tail(row.lang?.value)],['countries',tail(row.country?.value)],['tmdbIds',row.tmdb?.value],['years',yearOf(row.date?.value)]]) {
      if(value&&!r[key].includes(value))r[key].push(value);
    }
    for(const name of (row.aliases?.value || '').split('|||')) {const n=normalize(name);if(n&&!r.names.includes(n))r.names.push(n);}
  }return records;
}

export function wikiReason(item, r) {
  if(!r||!r.items.length)return 'missing_identity';
  if(r.items.length!==1)return 'ambiguous_identity';
  if(!r.countries.includes('Q668'))return 'not_confirmed_indian';
  if(!r.languages.length)return 'missing_original_language';
  if(r.languages.includes('Q8097'))return 'original_telugu';
  if(!r.names.includes(normalize(item.name)))return 'title_mismatch';
  return null;
}

export function canonicalReason(item, r, canonical) {
  if(!canonical)return 'awaiting_second_identity_check';
  if(!canonical.countries.includes('india'))return 'canonical_country_mismatch';
  if(!r.names.includes(normalize(canonical.name)))return 'canonical_title_mismatch';
  if(r.tmdbIds.length && (!canonical.tmdbId || !r.tmdbIds.includes(canonical.tmdbId)))return 'canonical_tmdb_mismatch';
  const year=yearOf(item.releaseInfo);
  if(year&&canonical.year&&year!==canonical.year)return 'canonical_year_mismatch';
  return null;
}

function safeImage(url) {try {const u=new URL(url);return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}}

export function releaseDate(value) {
  const day=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const date=new Date(day+'T00:00:00.000Z');
  return Number.isFinite(date.getTime())&&date.toISOString().startsWith(day)?date.toISOString():null;
}

export function newestFirst(movies) {
  return [...movies].sort((a,b)=>{
    const date=x=>releaseDate(x.ottReleaseDate)||releaseDate(x.released)||`${yearOf(x.releaseInfo)||'0000'}-01-01T00:00:00.000Z`;
    return date(b).localeCompare(date(a))||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
  });
}

