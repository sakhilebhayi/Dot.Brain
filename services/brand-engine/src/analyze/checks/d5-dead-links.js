// d5.dead_links: share of internal links (<a href>, <form action>) in templates that resolve to a route in
// routes/*.php, a named route, or a file in the checkout. A link that static analysis cannot judge (a
// variable, a package-provided route, an asset that is built at deploy time, a client-side router) is
// counted as unverifiable and left out of the share; the detail says how many.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { routeTable, pathMatches } from './_lib/routes.js';
import { DYN } from './_lib/markup.js';
import { safeRel } from './_lib/repo.js';

const ID = 'd5.dead_links';
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;
const BUILT = /^\/(?:build|storage|vendor|livewire|_|css|js|fonts|images|img|assets|dist|favicon|robots|sitemap|manifest|sw\.js|up$|broadcasting|sanctum|horizon|telescope|nova|\.well-known)/i;
const PACKAGE_PATH = /^\/(?:login|logout|register|forgot-password|reset-password|password|email|verify-email|user|two-factor|confirm-password|current-team|teams|api-tokens|admin)(?:\/|$)/i;
const PACKAGE_NAME = /^(?:login|logout|register|password\.|verification\.|two-factor\.|profile\.|sanctum\.|livewire\.|current-team\.|teams\.|api-tokens\.|terms\.|policy\.|filament\.|nova\.|passport\.|cashier\.|dashboard$)/;

function classify(link, t, table, repo) {
  // link: { value, exprs }
  let { value } = link;
  if (value.split('#')[0].split('?')[0] === DYN) {
    // the whole target is one expression: read route('name') and url('/path'); anything else is a variable
    const body = (link.exprs[0] ?? '').trim().replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\{!!\s*|\s*!!\}$/g, '');
    const rn = /^route\(\s*(['"])([\w.\-]+)\1/.exec(body);
    if (rn) {
      if (table.names.has(rn[2])) return { ok: true };
      if (table.packageRoutes && PACKAGE_NAME.test(rn[2])) return { unverifiable: true };
      return { dead: `route('${rn[2]}') names a route that is not defined in routes/*.php` };
    }
    const un = /^url\(\s*(['"])([^'"]*)\1\s*\)$/.exec(body);
    if (!un) return { unverifiable: true };
    value = un[2];
  }
  if (EXTERNAL.test(value)) return { skip: true };
  const path = value.split('#')[0].split('?')[0];
  if (path === '') return { skip: true };
  if (path.replaceAll(DYN, '') === '' || path.startsWith(DYN)) return { unverifiable: true };
  if (path.startsWith('/')) {
    const shipped = safeRel(`public${path}`);
    if (shipped && !path.includes(DYN) && path !== '/' && repo.exists(shipped)) return { ok: true };
    if (BUILT.test(path)) return { unverifiable: true };
    if (table.hasRoutes) {
      if (pathMatches(table, path)) return { ok: true };
      const pub = safeRel(`public${path}`);
      if (pub && !path.includes(DYN) && (repo.exists(pub) || repo.exists(`${pub.replace(/\/$/, '')}/index.html`))) return { ok: true };
      if (table.packageRoutes && PACKAGE_PATH.test(path)) return { unverifiable: true };
      return { dead: `${path.replaceAll(DYN, '{…}')} matches no route in routes/*.php and no file in public/` };
    }
    if (t.kind === 'html') {
      const clean = path.replace(/^\//, '').replace(/\/$/, '');
      const cands = [clean, `${clean}.html`, `${clean}/index.html`, `public/${clean}`, `public/${clean}.html`, `public/${clean}/index.html`].filter((c) => c && !c.includes(DYN));
      if (clean === '' || cands.some((c) => repo.exists(c))) return { ok: true };
      return { dead: `${path} matches no file in the checkout` };
    }
    return { unverifiable: true };
  }
  if (t.kind === 'html' && !table.hasRoutes) {
    const dir = t.rel.includes('/') ? t.rel.slice(0, t.rel.lastIndexOf('/')) : '';
    const joined = safeRel(`${dir}/${path}`.replace(/^\//, ''));
    if (joined === null) return { dead: `${path} leaves the checkout` };
    const cands = [joined, `${joined.replace(/\/$/, '')}/index.html`];
    if (path.includes(DYN)) return { unverifiable: true };
    return cands.some((c) => repo.exists(c)) ? { ok: true } : { dead: `${path} matches no file next to ${t.rel}` };
  }
  return { unverifiable: true };
}

export default defineCheck({
  id: ID,
  title: 'Internal links resolve',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const table = routeTable(repo);
    const findings = [];
    let ok = 0; let dead = 0; let unverifiable = 0;
    for (const t of templates(repo)) {
      if (t.kind === 'jsx' || t.kind === 'vue' || t.kind === 'svelte') {
        // client-side routers: links cannot be matched to a server route table
        for (const el of t.elements) if (el.tag === 'a' && el.attrs.has('href') && !el.component) unverifiable += 1;
        continue;
      }
      for (const el of t.elements) {
        if (el.component) continue;
        const a = el.tag === 'a' ? el.attrs.get('href') : el.tag === 'form' ? el.attrs.get('action') : null;
        if (!a || (a.dynamic && !a.value.includes(DYN))) { if (a) unverifiable += 1; continue; }
        const r = classify({ value: a.value.trim(), exprs: a.exprs }, t, table, repo);
        if (r.skip) continue;
        if (r.ok) ok += 1;
        else if (r.dead) {
          dead += 1;
          findings.push({ rule: 'dead-internal-link', severity: 'major', message: `Dead internal link: ${r.dead}.`, file: t.rel, line: a.line, hint: 'Point the link at an existing route, or remove it until the page exists.' });
        } else unverifiable += 1;
      }
    }
    if (ok + dead === 0) return { notMeasured: `no internal link could be checked statically (${unverifiable} unverifiable: variables, package routes, client-side routers or build output)` };
    return {
      value: ok / (ok + dead),
      detail: `${ok} of ${ok + dead} checkable internal links resolve; ${unverifiable} link(s) could not be judged statically and are not counted. ${table.hasRoutes ? `${table.routes.length} route(s) read from ${table.files.length} file(s) in routes/` : 'No routes/ directory: links were matched to files'}${table.packageRoutes ? '; package-provided routes (login, register, ...) are treated as unverifiable' : ''}.`,
      findings,
    };
  },
});
