"""Read factual original-language fields from a public TMDB movie page."""
import json
import re
import sys
from html.parser import HTMLParser


class MovieFacts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.canonical = ""
        self.paragraph = None
        self.languages = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("property") == "og:title":
            self.title = attrs.get("content", "")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href", "")
        if tag == "p":
            self.paragraph = []

    def handle_data(self, text):
        if self.paragraph is not None:
            self.paragraph.append(text)

    def handle_endtag(self, tag):
        if tag == "p" and self.paragraph is not None:
            text = " ".join(" ".join(self.paragraph).split())
            match = re.fullmatch(r"Original Language\s+(.+)", text)
            if match:
                self.languages.append(match.group(1))
            self.paragraph = None


if __name__ == "__main__":
    page = MovieFacts()
    page.feed(sys.stdin.read())
    # A changed layout or challenge page must never invent a film's language.
    if not page.title or not page.canonical or len(page.languages) != 1:
        sys.exit("Public movie page is missing unambiguous original-language facts")
    print(json.dumps({"title": page.title, "canonical": page.canonical,
                      "originalLanguage": page.languages[0]}))
