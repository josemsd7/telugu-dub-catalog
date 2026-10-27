"""Factual fields from 91mobiles' public show lists and streaming labels."""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import json,re,sys
from source_parser import parse_date,platform_names

BASE='https://www.91mobiles.com'
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Node:
    def __init__(self,tag='',attrs=None):self.tag=tag;self.attrs=attrs or {};self.children=[]
    def text(self):return ' '.join(' '.join(x.text() if isinstance(x,Node) else x for x in self.children).split())
    def all(self,predicate):
        for c in self.children:
            if isinstance(c,Node):
                if predicate(c):yield c
                yield from c.all(predicate)
    def has(self,name):return name in self.attrs.get('class','').split()
class Tree(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root]
    def handle_starttag(self,tag,attrs):
        n=Node(tag,dict(attrs));self.stack[-1].children.append(n)
        if tag not in VOID:self.stack.append(n)
    def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag:self.stack=self.stack[:i];break
    def handle_data(self,data):self.stack[-1].children.append(data)
def tree(html):p=Tree();p.feed(html);return p.root
def safe_url(value):
    u=urlparse(urljoin(BASE,value))
    u=u._replace(path=re.sub(r'/+','/',u.path))
    return u.geturl() if u.scheme=='https' and u.netloc=='www.91mobiles.com' and re.fullmatch(r'/entertainment/[^/?#]+-series-\d+',u.path) and not u.query and not u.fragment else None
def parse_list(html):
    root=tree(html);rows=[]
    for card in root.all(lambda n:n.has('pro_item') and n.has('card_box')):
        heading=next(card.all(lambda n:n.tag=='h3'),None)
        link=next(heading.all(lambda n:n.tag=='a' and safe_url(n.attrs.get('href',''))),None) if heading else None
        if not link:continue
        info=next(card.all(lambda n:n.has('imdb_box')),None)
        date_line=next((p.text() for p in info.all(lambda n:n.tag=='p') if '|' in p.text()),'') if info else ''
        date=parse_date(date_line)
        cast='';labels=list(card.all(lambda n:n.tag=='label'))
        for label in labels:
            if label.text().lower()=='top cast':
                # The factual cast paragraph follows the label in the same box.
                box=next(card.all(lambda n:n.has('movi_det')),None)
                if box:
                    children=[c for c in box.children if isinstance(c,Node)]
                    for i,c in enumerate(children):
                        if c is label and i+1<len(children):cast=children[i+1].text()
        rows.append({'title':link.text(),'ottReleaseDate':date,'originalLanguageText':date_line.split('|')[0].strip(),
                     'sourceUrl':safe_url(link.attrs['href']),'genreText':'Series','castText':cast})
    if not rows:raise ValueError('91mobiles show cards not found')
    button=next(root.all(lambda n:n.attrs.get('id')=='list-loadmore-btn'),None)
    return {'rows':rows,'totalRecords':int(button.attrs.get('data-total-records',len(rows))) if button else len(rows),
            'pageSize':int(button.attrs.get('data-num-records',24)) if button else 24}
def objects(value):
    if isinstance(value,list):
        for v in value:yield from objects(v)
    elif isinstance(value,dict):
        yield value
        if isinstance(value.get('@graph'),list):yield from objects(value['@graph'])
def parse_detail(html):
    root=tree(html)
    heading=next(root.all(lambda n:n.tag=='h1'),None)
    canonical=next((n.attrs.get('content') for n in root.all(lambda n:n.tag=='meta' and n.attrs.get('property')=='og:url')),None)
    if not heading or not canonical or not safe_url(canonical):raise ValueError('91mobiles show identity fields missing')
    docs=[]
    for n in root.all(lambda n:n.tag=='script' and n.attrs.get('type')=='application/ld+json'):
        try:docs.extend(objects(json.loads(''.join(c for c in n.children if isinstance(c,str)))))
        except ValueError:pass
    if not any(n.get('@type') in ('TVSeries','TVSeason') for n in docs):raise ValueError('91mobiles page is not a series')
    title=re.sub(r'\s*\((?:U|A|UA[^)]*|TV-[^)]*)\)\s*$','',heading.text()).strip()
    original='';cast=''
    for li in root.all(lambda n:n.tag=='li'):
        text=li.text()
        if text.startswith('Language(s):'):original=text[len('Language(s):'):].strip()
        if text.startswith('Cast(s):'):cast=text[len('Cast(s):'):].split('See all')[0].strip()
    telugu=[];languages=[]
    for a in root.all(lambda n:n.tag=='a' and n.attrs.get('data-category')=='detail-watch' and n.attrs.get('data-action')=='stream'):
        text=a.text()
        labels=re.findall(r'\[([^]]+)\]',text)
        languages.extend(labels)
        if any(re.search(r'\btelugu\b',x,re.I) and not re.search('subtitle',x,re.I) for x in labels):
            telugu.extend(platform_names(text))
    episodes=[]
    for a in root.all(lambda n:n.tag=='a' and n.has('card-accordion-head')):
        text=a.attrs.get('title') or a.text()
        m=re.search(r'Season\s+(\d+)\s*:\s*E\s*(\d+)',text,re.I);d=parse_date(text)
        if m and d:episodes.append({'season':int(m[1]),'episode':int(m[2]),'releasedDate':d})
    return {'title':title,'sourceUrl':safe_url(canonical),'originalLanguageText':original,'castText':cast,
            'teluguPlatforms':list(dict.fromkeys(telugu)),'listedAudioLanguages':list(dict.fromkeys(languages)),'episodes':episodes}
if __name__=='__main__':
    try:print(json.dumps((parse_detail if sys.argv[1]=='detail' else parse_list)(sys.stdin.read()),ensure_ascii=False))
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
