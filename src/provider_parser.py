"""Read identity facts from the exact public Netflix title linked by a publisher."""
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse

def title_id(url):
    try:
        parsed=urlparse(url)
        match=re.fullmatch(r'/(?:[a-z]{2}(?:-[a-z]{2})?/)?title/(\d+)',parsed.path,re.I)
        return match[1] if parsed.scheme=='https' and parsed.hostname in ('www.netflix.com','netflix.com') and match else None
    except (ValueError,TypeError):return None

class Documents(HTMLParser):
    def __init__(self):super().__init__();self.parts=None;self.documents=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and dict(attrs).get('type')=='application/ld+json':self.parts=[]
    def handle_data(self,text):
        if self.parts is not None:self.parts.append(text)
    def handle_endtag(self,tag):
        if tag=='script' and self.parts is not None:
            try:self.documents.append(json.loads(''.join(self.parts)))
            except ValueError:pass
            self.parts=None

def objects(value):
    if isinstance(value,list):
        for child in value:yield from objects(child)
    elif isinstance(value,dict):
        yield value
        if '@graph' in value:yield from objects(value['@graph'])

if __name__=='__main__':
    url,expected=sys.argv[1:3]
    key=title_id(url)
    if not key or expected not in ('Movie','TVSeries'):sys.exit('Unsupported public title URL or media type')
    parser=Documents();parser.feed(sys.stdin.read())
    hits=[x for doc in parser.documents for x in objects(doc) if x.get('@type')==expected and title_id(x.get('url'))==key]
    if len(hits)!=1:sys.exit('Public title page does not unambiguously identify the linked media')
    item=hits[0]
    def people(*keys):
        result=[]
        for k in keys:
            values=item.get(k,[])
            for person in values if isinstance(values,list) else [values]:
                if isinstance(person,dict) and person.get('@type')=='Person' and isinstance(person.get('name'),str):result.append(person['name'][:160])
        return list(dict.fromkeys(result))[:40]
    cast=people('actors','actor','directors','director')
    if not item.get('name') or not cast:sys.exit('Public title page lacks title and cast facts')
    print(json.dumps({'title':item['name'][:300],'cast':cast,'type':expected,'sourceUrl':url}))
