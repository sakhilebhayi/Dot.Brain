// Lightweight regex-based RSS 2.0 <item> extractor -- not a full
// RSS/Atom-spec-compliant XML parser. Handles the common
// title/link/pubDate/description shape; feeds using CDATA sections,
// namespaced elements, or the Atom format are not handled and will
// return fewer or no items rather than throwing.

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return null;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
    .trim();
}

export function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks.map((block) => ({
    title: extractTag(block, 'title'),
    link: extractTag(block, 'link'),
    pubDate: extractTag(block, 'pubDate'),
    description: extractTag(block, 'description'),
  }));
}

export async function fetchRssFeed(feedUrl) {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed ${feedUrl}: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseRssItems(xml);
}
