"""Extract factual release fields from the publisher's public release table."""
from html.parser import HTMLParser
from datetime import date
from urllib.parse import urlparse, urljoin, parse_qs, unquote
import json
import re
import sys

SOURCE_URL = 'https://ottreleasemovies.com/'
PLATFORM_ICONS = {
    'Screenshot-2026-06-12-182708.png': 'JioHotstar',
    'Screenshot-2026-06-12-182701.png': 'ZEE5',
    'Screenshot-2026-06-12-182828.png': 'Aha',
    'Screenshot-2026-06-12-183803.png': 'Prime Video',
    'Screenshot-2026-06-12-182841.png': 'Sun NXT',
    'Screenshot-2026-06-12-182820.png': 'SonyLIV',
    'Screenshot-2026-06-12-182811.png': 'ETV Win',
}
NAMED_PLATFORMS = {'netflix':'Netflix', 'prime':'Prime Video', 'hotstar':'JioHotstar', 'zee5':'ZEE5', 'aha':'Aha', 'sony':'SonyLIV', 'sun-nxt':'Sun NXT', 'etv':'ETV Win', 'manorama':'Manorama Max', 'lionsgate':'Lionsgate Play', 'apple-tv':'Apple TV', 'peacock':'Peacock', 'diney':'Disney+', 'disney':'Disney+', 'jio-cinema':'JioCinema', 'saina':'Saina Play'}
NATIVE_LANGUAGES = {'తెలుగు':'Telugu', 'தமிழ்':'Tamil', 'हिन्दी':'Hindi', 'हिंदी':'Hindi', 'ಕನ್ನಡ':'Kannada', 'മലയാളം':'Malayalam'}

class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables=[]; self.depth=0; self.table=None; self.row=None; self.cell=None
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag=='table':
            self.depth+=1
            if self.depth==1: self.table=[]
        if self.depth!=1: return
        if tag=='tr': self.row=[]
        if tag in ('td','th'): self.cell={'parts':[], 'images':[], 'links':[]}
        if self.cell is not None:
            if tag=='img': self.cell['images'].append(attrs)
            if tag=='a' and attrs.get('href'): self.cell['links'].append(attrs['href'])
    def handle_data(self, data):
        if self.depth==1 and self.cell is not None: self.cell['parts'].append(data)
    def handle_endtag(self, tag):
        if self.depth==1:
            if tag in ('td','th') and self.cell is not None and self.row is not None:
                self.cell['text']=' '.join(' '.join(self.cell.pop('parts')).split())
                self.row.append(self.cell); self.cell=None
            if tag=='tr' and self.row is not None: self.table.append(self.row); self.row=None
        if tag=='table' and self.depth:
            if self.depth==1: self.tables.append(self.table); self.table=None
            self.depth-=1

def parse_date(text):
    value=re.sub(r'(?<=\d)(st|nd|rd|th)\b', '', text, flags=re.I)
    months={name:i+1 for i,name in enumerate(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])}
    patterns=[r'(\d{1,2})\s*([A-Za-z]{3,9})\s*,?\s*(20\d{2})', r'([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s*(20\d{2})']
    for i,pattern in enumerate(patterns):
        match=re.search(pattern,value)
        if not match: continue
        day,month,year=match.groups() if i==0 else (match[2],match[1],match[3])
        try: return date(int(year),months[month.lower()[:3]],int(day)).isoformat()
        except (ValueError,KeyError): pass
    match=re.search(r'20\d{2}-\d{2}-\d{2}',value)
    if match:
        try: return date.fromisoformat(match[0]).isoformat()
        except ValueError: pass
    return None

def platforms(cell):
    names=[]; unknown=[]
    for image in cell.get('images',[]):
        src=image.get('src') or image.get('data-src') or ''
        filename=urlparse(src).path.rsplit('/',1)[-1]
        name=PLATFORM_ICONS.get(filename)
        label=' '.join([filename,image.get('alt') or '',image.get('title') or '']).lower()
        if not name: name=next((v for k,v in NAMED_PLATFORMS.items() if k in label),None)
        if name and name not in names: names.append(name)
        elif not name and filename: unknown.append(filename)
    if not names and cell.get('text'):
        label=cell['text'].lower()
        names=[v for k,v in NAMED_PLATFORMS.items() if k.replace('-',' ') in label]
    return list(dict.fromkeys(names)),list(dict.fromkeys(unknown))

def platform_names(text):
    names=[]
    aliases=[('netflix','Netflix'),('prime','Prime Video'),('hotstar','JioHotstar'),
             ('zee5','ZEE5'),('zee 5','ZEE5'),('aha','Aha'),('sony','SonyLIV'),
             ('sun nxt','Sun NXT'),('sun-nxt','Sun NXT'),('sunnxt','Sun NXT'),
             ('etv','ETV Win'),('manorama','Manorama Max'),('lionsgate','Lionsgate Play'),
             ('jio cinema','JioCinema'),('jiocinema','JioCinema'),('saina','Saina Play'),
             ('apple','Apple TV'),('youtube','YouTube')]
    value=text.lower()
    for token,name in aliases:
        if token in value and name not in names:names.append(name)
    return names

def parse_trendraja(html):
    url='https://trendraja.in/telugu-movie-ott-release-dates-2021/'
    parser=Tables();parser.feed(html)
    table=next((t for t in parser.tables if t and len(t[0])>=4
                and 'digital release date' in t[0][1]['text'].lower()
                and 'streaming partner' in t[0][2]['text'].lower()),None)
    if not table:raise ValueError('Trendraja release table not found')
    rows=[]
    for cells in table[1:]:
        if len(cells)<4:continue
        title,raw_date,platform,category=[c['text'] for c in cells[:4]]
        if not title:continue
        rows.append({'title':title,'ottReleaseDate':parse_date(raw_date),'dateText':raw_date,
                     'platforms':platform_names(platform),'genreText':category,'languageText':'Telugu',
                     'audioEvidence':'Publisher Telugu OTT release table', 'castText':'',
                     'sourceUrl':url,'sourceRank':len(rows),
                     'tentative':bool(re.search(r'\b(soon|tba|expected|tentative|rumou?r)\b',raw_date,re.I))})
    if not rows:raise ValueError('Trendraja release table empty')
    return {'sourceUrl':url,'sourceRowCount':len(rows),'rows':rows}

class SacnilkCards(HTMLParser):
    def __init__(self, series=False):
        super().__init__(convert_charrefs=True)
        self.rows=[];self.card=None;self.pages={1};self.series=series
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='a':
            href=attrs.get('href','')
            query=parse_qs(urlparse(href).query)
            if query.get('page',[''])[0].isdigit():self.pages.add(int(query['page'][0]))
            if href.startswith('/series/' if self.series else '/movie/') and 'data-languages' in attrs and 'data-platforms' in attrs:
                self.card={'href':href,'languages':attrs['data-languages'],'platforms':attrs['data-platforms'],
                           'parts':[],'title':''}
        if self.card is not None:
            if tag=='h3' and attrs.get('title'):self.card['title']=attrs['title']
            if tag=='img' and not self.card['title']:self.card['title']=attrs.get('alt','')
    def handle_data(self,text):
        if self.card is not None:self.card['parts'].append(text)
    def handle_endtag(self,tag):
        if tag=='a' and self.card is not None:
            c=self.card;self.card=None
            if not c['title']:return
            text=' '.join(' '.join(c['parts']).split())
            year=re.search(r'_(20\d{2})$',unquote(urlparse(c['href']).path))
            self.rows.append({'title':c['title'],'ottReleaseDate':parse_date(text),'dateText':text[:100],
                              'platforms':platform_names(c['platforms']),'genreText':'Series' if self.series else 'Movie',
                              'languageText':c['languages'],'audioEvidence':'Publisher OTT availability-language field',
                              'castText':'','movieYearHint':year[1] if year else None,
                              'sourceUrl':urljoin('https://www.sacnilk.com/',c['href']),
                              'sourceRank':len(self.rows),'tentative':'coming soon' in text.lower()})
            if self.series:
                season=re.search(r'/season/(\d+)',c['href'])
                self.rows[-1]['season']=int(season[1]) if season else None

def parse_sacnilk(html):
    parser=SacnilkCards();parser.feed(html)
    if not parser.rows:raise ValueError('Sacnilk OTT movie cards not found')
    return {'sourceUrl':'https://www.sacnilk.com/ott-movie-releases',
            'sourceRowCount':len(parser.rows),'totalPages':max(parser.pages),'rows':parser.rows}

def parse_sacnilk_series(html):
    parser=SacnilkCards(series=True);parser.feed(html)
    if not parser.rows:raise ValueError('Sacnilk series cards not found')
    return {'sourceUrl':'https://www.sacnilk.com/entertainmenttopbar/Recent_WebSeries',
            'sourceRowCount':len(parser.rows),'totalPages':max(parser.pages),'rows':parser.rows}

def parse_source(html):
    parser=Tables(); parser.feed(html)
    table=next((t for t in parser.tables if t and any('dubbing' in c['text'].lower() for c in t[0]) and any('ott release date' in c['text'].lower() for c in t[0])),None)
    if table is None: raise ValueError('Publisher release table not found; preserving previous catalog')
    rows=[]
    for index,cells in enumerate(table[1:]):
        if len(cells)<6: continue
        title,raw_date,_,genre,language,cast=[c['text'] for c in cells[:6]]
        if not title: continue
        for native,english in NATIVE_LANGUAGES.items(): language=language.replace(native,english)
        names,unknown=platforms(cells[2])
        links=[x for x in cells[0].get('links',[]) if urlparse(x).hostname=='ottreleasemovies.com']
        rows.append({'title':title,'ottReleaseDate':parse_date(raw_date),'dateText':raw_date,'platforms':names,'unknownPlatformIcons':unknown,'genreText':genre,'languageText':language,'castText':cast,'sourceUrl':links[0] if links else SOURCE_URL,'sourceRank':index,'tentative':bool(re.search(r'\b(tba|expected|expecting|tentative|rumou?r|unconfirmed|to be announced)\b',raw_date+' '+language,re.I))})
    if not rows: raise ValueError('Publisher release table is empty; preserving previous catalog')
    return {'sourceUrl':SOURCE_URL,'sourceRowCount':len(rows),'rows':rows}

if __name__=='__main__':
    try:
        kind=sys.argv[1] if len(sys.argv)>1 else 'ottreleasemovies'
        parser={'ottreleasemovies':parse_source,'trendraja':parse_trendraja,'sacnilk':parse_sacnilk,'sacnilk-series':parse_sacnilk_series}[kind]
        print(json.dumps(parser(sys.stdin.read()),ensure_ascii=False))
    except Exception as error:
        print(str(error),file=sys.stderr); sys.exit(1)

