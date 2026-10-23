// d5.route_inventory_vs_claims: features listed in README.md / PRODUCT.md under a "Features"-style heading,
// matched to the routes in routes/*.php (or static pages / page files) by shared keywords. A claim counts as
// backed when at least one significant word of it appears in some route path, route name or page name.
// This is a keyword match, not proof that the feature works, and a missing match is not proof that it does not.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { routeTable } from './_lib/routes.js';

const ID = 'd5.route_inventory_vs_claims';
const DOCS = ['README.md', 'PRODUCT.md', 'README_FEATURES.md', 'FEATURES.md'];
const HEADING = /^(#{1,4})\s*(?:\W*\s*)?(features?|key features|core features|capabilities|what (?:it|this) does|modules?|functionality|platform features|what you get)\b/i;
const STOP = new Set(['with', 'your', 'that', 'this', 'from', 'into', 'over', 'more', 'have', 'each', 'across', 'every', 'their', 'such', 'also', 'full', 'real', 'time', 'easy', 'fast', 'built', 'ready', 'based', 'support', 'supports', 'manage', 'create', 'track', 'view', 'share', 'send', 'make', 'help', 'helps', 'allow', 'allows', 'users', 'user', 'team', 'teams', 'data', 'powerful', 'simple', 'secure', 'smart', 'custom', 'including', 'features', 'feature', 'dashboard']);

const stem = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : /(?:ss|us|is)$/.test(w) || !w.endsWith('s') ? w : w.slice(0, -1));
const words = (s) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).map(stem).filter((w) => w.length >= 4 && !STOP.has(w));

function claimsOf(text, file) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const h = HEADING.exec(lines[i]);
    if (!h) continue;
    const level = h[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextH = /^(#{1,6})\s/.exec(lines[j]);
      if (nextH && nextH[1].length <= level) break;
      const b = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(lines[j]);
      if (!b) continue;
      const clean = b[1].replace(/\*\*|__|`|\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\W+/, '');
      const label = clean.split(/\s[-–—:]\s|:\s/)[0].slice(0, 80);
      const ws = words(label.length >= 8 ? label : clean);
      if (ws.length) out.push({ label, words: ws, file, line: j + 1 });
    }
  }
  return out;
}

export default defineCheck({
  id: ID,
  title: 'Claimed features have a matching route',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0 || routeTable(repo).hasRoutes,
  measure(repo) {
    const claims = DOCS.flatMap((d) => (repo.exists(d) ? claimsOf(repo.read(d) ?? '', d) : []));
    if (claims.length === 0) return { notMeasured: 'no feature list was found under a "Features"/"Capabilities"-style heading in README.md or PRODUCT.md' };

    const table = routeTable(repo);
    const tokens = new Set();
    const addPath = (p) => { for (const seg of p.split(/[/._-]+/)) for (const w of words(seg.replace(/[{}?]/g, ''))) tokens.add(w); };
    for (const r of table.routes) { addPath(r.path); if (r.name) addPath(r.name); if (r.view) addPath(r.view); }
    for (const e of repo.list((rel) => /^(?:src\/)?(?:pages|views|routes|app)\/.+\.(?:vue|jsx|tsx|svelte|astro)$/.test(rel) || /^(?:resources\/views\/)[^/]+\.blade\.php$/.test(rel))) addPath(e);
    for (const e of repo.list((rel, k) => k === 'html' && !/(?:^|\/)(?:node_modules|vendor|tests?|docs)\//.test(rel))) addPath(e);
    if (tokens.size === 0) return { notMeasured: `${claims.length} feature claim(s) found but no route, page or view names to compare them with (no routes/*.php, page files or static pages)` };

    const findings = [];
    let backed = 0;
    for (const c of claims) {
      if (c.words.some((w) => tokens.has(w))) backed += 1;
      else findings.push({ rule: 'claim-without-route', severity: 'minor', message: `The claimed feature "${c.label}" shares no keyword with any route, page or view name (${c.words.slice(0, 4).join(', ')}).`, file: c.file, line: c.line, hint: 'Check that the feature is built and reachable; if it is not, remove it from the feature list. If it is, a route or page name that does not contain the keyword is a false positive.' });
    }
    return {
      value: backed / claims.length,
      detail: `${backed} of ${claims.length} claimed features share a keyword with ${tokens.size} route, page or view name word(s). This is a keyword match against names, not a test that the feature works.`,
      findings,
    };
  },
});
