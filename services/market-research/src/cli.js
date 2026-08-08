#!/usr/bin/env node
import { openMemory, findValid, save } from './memory.js';
import { fetchWebPage } from './fetchWeb.js';
import { fetchRssFeed } from './fetchRss.js';
import { searchGithubRepos } from './fetchGithub.js';
import { extractFindings } from './extract.js';

function parseArgs(argv) {
  const [command, topic, ...rest] = argv;
  const options = { market: 'South Africa', platform: null, urls: [], rss: [], channels: [] };

  for (const arg of rest) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'market') options.market = value;
    if (key === 'platform') options.platform = value;
    if (key === 'urls') options.urls = value.split(',');
    if (key === 'rss') options.rss = value.split(',');
    if (key === 'channels') options.channels = value.split(',');
  }

  return { command, topic, options };
}

async function main() {
  const { command, topic, options } = parseArgs(process.argv.slice(2));

  if (command !== 'research' || !topic) {
    console.error('Usage: market-research research "<topic>" --market="South Africa" [--platform=dot-mines] [--urls=url1,url2] [--rss=feed1,feed2] [--channels=github] [--github-query="..."]');
    process.exit(1);
  }

  const memory = openMemory(new URL('../data/research.sqlite', import.meta.url).pathname);

  const existing = findValid(memory, { topic, market: options.market });
  if (existing) {
    console.log(`Reusing existing finding (no new fetch needed): "${existing.finding}"`);
    console.log(`Source: ${existing.source}, expires ${existing.expiry_date}`);
    return;
  }

  console.log(`No valid existing finding for "${topic}" (${options.market}) -- researching.`);

  const apiKey = process.env.ANTHROPIC_API_KEY || null;
  if (!apiKey) {
    console.log('Note: ANTHROPIC_API_KEY not set -- findings will be stored as raw pending_extraction captures, not structured.');
  }

  let fetchedAny = false;

  for (const url of options.urls) {
    console.log(`Fetching web page: ${url}`);
    const page = await fetchWebPage(url);
    const rows = await extractFindings(
      { text: page.text, source: url, topic, market: options.market, relatedPlatform: options.platform },
      { apiKey }
    );
    rows.forEach((row) => save(memory, row));
    console.log(`  -> ${rows.length} finding(s) saved (status: ${rows[0]?.status}).`);
    fetchedAny = true;
  }

  for (const feedUrl of options.rss) {
    console.log(`Fetching RSS feed: ${feedUrl}`);
    const items = await fetchRssFeed(feedUrl);
    for (const item of items.slice(0, 5)) {
      const rows = await extractFindings(
        { text: `${item.title}\n${item.description ?? ''}`, source: item.link ?? feedUrl, topic, market: options.market, relatedPlatform: options.platform },
        { apiKey }
      );
      rows.forEach((row) => save(memory, row));
    }
    console.log(`  -> processed ${Math.min(items.length, 5)} item(s).`);
    fetchedAny = true;
  }

  if (options.channels.includes('github')) {
    console.log(`Searching public GitHub for: ${topic}`);
    const repos = await searchGithubRepos(topic);
    for (const repo of repos.slice(0, 5)) {
      const rows = await extractFindings(
        { text: `${repo.fullName}: ${repo.description ?? ''} (${repo.stars} stars, updated ${repo.updatedAt})`, source: repo.url, topic, market: options.market, relatedPlatform: options.platform },
        { apiKey }
      );
      rows.forEach((row) => save(memory, row));
    }
    console.log(`  -> processed ${Math.min(repos.length, 5)} repo(s).`);
    fetchedAny = true;
  }

  if (!fetchedAny) {
    console.log('No channels specified -- pass --urls, --rss, and/or --channels=github to actually research something.');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
