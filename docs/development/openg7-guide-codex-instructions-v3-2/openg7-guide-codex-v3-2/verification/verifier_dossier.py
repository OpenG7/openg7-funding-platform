#!/usr/bin/env python3
"""Vérifie les liens Markdown locaux et le comptage des 44 liens source V3.2.
Ne vérifie PAS la disponibilité HTTP de tous les liens GitHub."""
from pathlib import Path
import re, sys
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'source'/'README-blueprint-actuel.md'
PATTERN=re.compile(r'\]\(([^)]*)\)')
text=SOURCE.read_text(encoding='utf-8')
urls=PATTERN.findall(text)
assert len(urls)==44, f'44 links expected in source, got {len(urls)}'
assert len([u for u in urls if u.startswith('../captures/')])==7
assert len([u for u in urls if u.startswith('https://github.com/OpenG7/openg7-funding-platform/blob/1108d8a9/')])==37
bad=[]
for f in sorted(ROOT.rglob('*.md')):
    for url in PATTERN.findall(f.read_text(encoding='utf-8')):
        if not url or url.startswith(('#','http://','https://','mailto:')):
            continue
        pp=(f.parent/url.split('#',1)[0]).resolve()
        if not pp.exists():bad.append((f.relative_to(ROOT).as_posix(),url))
assert not bad, f'Unresolved local links: {bad}'
print('OK: 44/44 source links rewritten: 7 local capture files, 37 pinned GitHub links')
print('OK: all relative links in active Markdown files have an existing target in the archive')
print('NOTE: HTTP reachability not checked for all GitHub URLs; eight representative paths were checked through the GitHub connector.')
