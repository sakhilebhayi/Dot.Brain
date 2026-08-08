// Basic robots.txt parser -- handles the common `User-agent: *` /
// `Disallow: <path>` case only. Not a full robots.txt specification
// implementation: crawl-delay, wildcard patterns, and per-agent rules
// beyond `*` are not handled. Absence of a robots.txt, or a parse
// failure, defaults to "allowed" (no restriction was declared), not
// "disallowed" -- fail-open here matches how a real crawler treats a
// missing file, not a security boundary.

export function parseRobotsTxt(content) {
  const disallowed = [];
  let inWildcardBlock = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      inWildcardBlock = value === '*';
    } else if (key === 'disallow' && inWildcardBlock && value !== '') {
      disallowed.push(value);
    }
  }

  return {
    isPathAllowed(path) {
      return !disallowed.some((rule) => path.startsWith(rule));
    },
  };
}

export async function isAllowed(url) {
  const origin = new URL(url).origin;
  const path = new URL(url).pathname;

  try {
    const response = await fetch(`${origin}/robots.txt`);
    if (!response.ok) return true; // no robots.txt declared -- allowed
    const content = await response.text();
    return parseRobotsTxt(content).isPathAllowed(path);
  } catch {
    return true; // fetch failure -- fail-open, matches "no restriction declared"
  }
}
