// Shared Markdown subset used by the local documentation checks.
export function markdownProse(text) {
  let fence = null;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length
        ) {
          fence = null;
        }
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
}

export function markdownAnchors(text) {
  const prose = markdownProse(text);
  const anchors = new Set(
    [...prose.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)].map(
      (match) => match[1]
    )
  );
  const counts = new Map();
  for (const match of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(base) ?? 0;
    anchors.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  return anchors;
}
