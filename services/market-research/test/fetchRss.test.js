import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRssItems } from '../src/fetchRss.js';

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <pubDate>Mon, 01 Aug 2026 00:00:00 GMT</pubDate>
      <description>First post description</description>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <pubDate>Tue, 02 Aug 2026 00:00:00 GMT</pubDate>
      <description>Second post description</description>
    </item>
  </channel>
</rss>`;

test('parseRssItems extracts all items with their fields', () => {
  const items = parseRssItems(SAMPLE_RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'First Post');
  assert.equal(items[0].link, 'https://example.com/first');
  assert.equal(items[1].title, 'Second Post');
});

test('parseRssItems returns an empty array for feed with no items', () => {
  const items = parseRssItems('<rss version="2.0"><channel><title>Empty</title></channel></rss>');
  assert.equal(items.length, 0);
});
