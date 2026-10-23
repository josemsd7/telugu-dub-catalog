"""Extract factual release fields from the publisher's public release table."""
from html.parser import HTMLParser
from datetime import date
from urllib.parse import urlparse
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
    try: print(json.dumps(parse_source(sys.stdin.read()),ensure_ascii=False))
    except Exception as error:
        print(str(error),file=sys.stderr); sys.exit(1)
