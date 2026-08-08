import { isAllowed } from './robots.js';

// Strips scripts/styles then all remaining tags -- a pragmatic
// "good enough for LLM context" text extraction, not a polished
// reader-view algorithm. Documented as a known limitation, not a claim
// of production-grade content extraction.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

export async function fetchWebPage(url) {
  const allowed = await isAllowed(url);
  if (!allowed) {
    throw new Error(`Fetching ${url} is disallowed by robots.txt`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();

  return {
    url,
    title: extractTitle(html),
    text: htmlToText(html),
    fetchedAt: new Date().toISOString(),
  };
}
