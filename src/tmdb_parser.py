"""Read factual original-language fields from a public TMDB movie page."""
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse


class MovieFacts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.canonical = ""
        self.paragraph = None
        self.languages = []
        self.json_parts = None
        self.documents = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("property") == "og:title":
            self.title = attrs.get("content", "")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href", "")
        if tag == "p":
            self.paragraph = []
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.json_parts = []

    def handle_data(self, text):
        if self.paragraph is not None:
            self.paragraph.append(text)
        if self.json_parts is not None:
            self.json_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "script" and self.json_parts is not None:
            raw="".join(self.json_parts).strip()
            prefix,suffix='/* <![CDATA[ */','/* ]]> */'
            if raw.startswith(prefix) and raw.endswith(suffix):raw=raw[len(prefix):-len(suffix)].strip()
            try:self.documents.append(json.loads(raw))
            except ValueError:pass
            self.json_parts = None
        if tag == "p" and self.paragraph is not None:
            text = " ".join(" ".join(self.paragraph).split())
            match = re.fullmatch(r"Original Language\s+(.+)", text)
            if match:
                self.languages.append(match.group(1))
            self.paragraph = None

    def structured_facts(self):
        def key(url):
            try:
                parsed=urlparse(url)
                match=re.fullmatch(r'/movie/(\d+)(?:-[^/]+)?/?',parsed.path)
                return match[1] if parsed.scheme=='https' and parsed.netloc=='www.themoviedb.org' and match else None
            except (ValueError,TypeError):return None
        def objects(value):
            if isinstance(value,list):
                for child in value:yield from objects(child)
            elif isinstance(value,dict):
                yield value
                if isinstance(value.get('@graph'),list):yield from objects(value['@graph'])
        movies=[v for d in self.documents for v in objects(d)
                if v.get('@type')=='Movie' and key(v.get('url')) is not None
                and key(v.get('url'))==key(self.canonical)]
        if len(movies)!=1:return None
        movie=movies[0];countries=movie.get('countryOfOrigin',[])
        if isinstance(countries,dict):countries=[countries]
        return {'url':movie['url'],'countries':[v['name'] for v in countries
                if isinstance(v,dict) and v.get('@type')=='Country' and isinstance(v.get('name'),str)],
                'image':movie.get('image') if isinstance(movie.get('image'),str) else None}


if __name__ == "__main__":
    page = MovieFacts()
    page.feed(sys.stdin.read())
    # A changed layout or challenge page must never invent a film's language.
    if not page.title or not page.canonical or len(page.languages) != 1:
        sys.exit("Public movie page is missing unambiguous original-language facts")
    print(json.dumps({"title": page.title, "canonical": page.canonical,
                      "originalLanguage": page.languages[0],"structured":page.structured_facts()}))
