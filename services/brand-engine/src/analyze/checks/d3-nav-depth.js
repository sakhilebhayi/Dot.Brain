// d3.nav_depth: nesting depth of links inside <nav> landmarks, as the number of clicks to reach each
// link from the page (a top-level item is 1, an item inside a dropdown is 2, and so on). Only navigation
// menus are read; the destinations' own links (how many clicks from the home page to a deep page) need a
// link graph that static analysis of templates cannot build. The bound is an engine default (3) unless the
// caller passes ctx.options.nav_depth_bound, and the detail says so.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { descendants } from './_lib/markup.js';

const ID = 'd3.nav_depth';
export const DEFAULT_BOUND = 3;

export default defineCheck({
  id: ID,
  title: 'Navigation menu depth',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo, ctx) {
    const bound = Number.isInteger(ctx?.options?.nav_depth_bound) ? ctx.options.nav_depth_bound : DEFAULT_BOUND;
    const declared = Number.isInteger(ctx?.options?.nav_depth_bound);
    const findings = [];
    let links = 0;
    let within = 0;
    let navs = 0;
    for (const t of templates(repo)) {
      for (const nav of t.elements.filter((e) => e.tag === 'nav' || e.attrs.get('role')?.value === 'navigation')) {
        if (nav.component) continue;
        navs += 1;
        for (const a of descendants(nav)) {
          if (a.type !== 'el' || a.tag !== 'a' || !a.attrs.has('href')) continue;
          let depth = 0;
          for (let p = a.parent; p && p !== nav && p.type === 'el'; p = p.parent) {
            const cls = `${p.attrs.get('class')?.value ?? ''}`.toLowerCase();
            if (p.tag === 'ul' || p.tag === 'ol' || p.tag === 'menu' || p.tag === 'details' || p.attrs.get('role')?.value === 'menu' || /\b(?:dropdown|submenu|sub-menu|flyout)\b/.test(cls)) depth += 1;
          }
          depth = Math.max(1, depth);
          links += 1;
          if (depth <= bound) within += 1;
          else findings.push({ rule: 'nav-too-deep', severity: 'minor', message: `A navigation link is ${depth} levels deep (bound ${bound}).`, file: t.rel, line: a.line, hint: 'Flatten the menu or promote this destination to a shallower level.' });
        }
      }
    }
    if (links === 0) return { notMeasured: navs === 0 ? 'no <nav> landmark with links was found in the templates' : 'navigation landmarks were found but they hold no static links' };
    return {
      value: within / links,
      detail: `${within} of ${links} navigation links are within ${bound} level(s) (${declared ? 'bound supplied by the caller' : 'engine default bound; the profile declares none'}) across ${navs} <nav> landmark(s). Click paths through pages are not measured.`,
      findings,
    };
  },
});
