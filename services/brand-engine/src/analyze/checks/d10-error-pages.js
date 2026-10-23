// d10.error_pages: share of the error statuses that render a designed page with a next step. Laravel apps
// are checked for 403, 404, 419, 500 and 503 in resources/views/errors (including the 4xx/5xx fallbacks);
// other sites (static HTML, page-file frameworks) for 404 only. "Designed" means the app ships its own view
// that is not the framework's default errors:: layout; "a next step" means the view, or a view it includes
// or extends, has a link or a button. Whether the page actually renders for that status needs a running app.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { routeTable } from './_lib/routes.js';
import { kindOf } from './_lib/repo.js';

const ID = 'd10.error_pages';
const LARAVEL_STATUSES = [403, 404, 419, 500, 503];

const viewPath = (name) => `resources/views/${name.replaceAll('.', '/')}.blade.php`;
const NEXT = /<a\b[^>]*\bhref\s*=|<button\b|<x-[\w.-]*(?:button|link)\b|<Link\b|<NuxtLink\b|\bhref\s*=\s*["']?(?:\/|\{\{)/i;

function sources(repo, rel, depth = 0, seen = new Set()) {
  if (seen.has(rel) || depth > 2) return [];
  seen.add(rel);
  const src = repo.read(rel);
  if (src === null) return [];
  const out = [src];
  for (const m of src.matchAll(/@(?:include|extends|component|includeIf|includeWhen|each)\w*\(\s*(?:[^,'")]+,\s*)?(['"])([\w.\-]+(?:::[\w.\-]+)?)\1/g)) {
    if (m[2].includes('::')) continue;
    const p = viewPath(m[2]);
    if (repo.exists(p)) out.push(...sources(repo, p, depth + 1, seen));
  }
  return out;
}

export default defineCheck({
  id: ID,
  title: 'Designed error pages with a next step',
  noUiReason: 'no templates or views found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const laravel = repo.hasDir('resources/views') && (routeTable(repo).hasRoutes || repo.exists('artisan') || repo.exists('composer.json'));
    const statuses = laravel ? LARAVEL_STATUSES : [404];
    const findings = [];
    let ok = 0;
    for (const s of statuses) {
      const group = s >= 500 ? '5xx' : '4xx';
      const cands = laravel
        ? [`resources/views/errors/${s}.blade.php`, `resources/views/errors/${group}.blade.php`,
          // Inertia apps render one error page for every status
          ...['vue', 'jsx', 'tsx'].flatMap((x) => [`resources/js/Pages/Error.${x}`, `resources/js/Pages/Errors/${s}.${x}`, `resources/js/Pages/Errors/Error.${x}`, `resources/js/pages/error.${x}`])]
        : [`${s}.html`, `public/${s}.html`, `errors/${s}.html`, `public/errors/${s}.html`, `src/pages/${s}.vue`, `src/pages/${s}.tsx`, `src/pages/${s}.jsx`, `pages/${s}.vue`, `pages/${s}.tsx`, `pages/${s}.jsx`, `src/pages/${s}.astro`];
      const found = cands.find((c) => repo.exists(c) && kindOf(c) !== 'other');
      const sev = s === 404 || s === 500 ? 'major' : 'minor';
      if (!found) {
        findings.push({ rule: 'error-page-missing', severity: sev, message: `No custom ${s} page was found (${cands.slice(0, 2).join(' or ')}); visitors get the framework or server default.`, file: laravel ? 'resources/views' : undefined, line: 1, hint: `Add a designed ${s} page that says what happened and offers a next step (home, retry, contact).` });
        continue;
      }
      const all = sources(repo, found);
      const defaultLayout = all.some((x) => /@extends\(\s*['"]errors::/.test(x));
      if (defaultLayout) {
        findings.push({ rule: 'error-page-framework-default', severity: 'minor', message: `The ${s} page extends the framework's errors:: layout, so it is the default design.`, file: found, line: 1, hint: 'Give it the product\'s own layout and wording.' });
        continue;
      }
      if (!all.some((x) => NEXT.test(x))) {
        findings.push({ rule: 'error-page-no-next-step', severity: 'minor', message: `The ${s} page has no link or button (including in views it includes or extends), so it ends the visit.`, file: found, line: 1, hint: 'Add a link home and, where useful, a retry or contact action.' });
        continue;
      }
      ok += 1;
    }
    return {
      value: ok / statuses.length,
      detail: `${ok} of ${statuses.length} error statuses (${statuses.join(', ')}) have a custom page with a link or button. ${laravel ? 'Laravel layout: resources/views/errors.' : 'No Laravel views found: only 404 was checked.'} Rendering with the right status needs a running app and is not measured.`,
      findings,
    };
  },
});
