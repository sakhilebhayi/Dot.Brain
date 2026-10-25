// d3.heading_structure: share of screens with exactly one level-one heading and no skipped levels.
// A screen is a page template (not a layout, component or partial). A page that extends a layout may take
// its <h1> from the layout, so such a page with no <h1> of its own is left out of the share, not failed.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { isScreenTemplate } from './_lib/repo.js';

const ID = 'd3.heading_structure';
// A layout holds the page chrome and a slot for the page: its headings are not a screen's outline.
const LAYOUT = /@yield\b|\$slot\b|<slot\b|\{\s*children\s*\}|@inertia\b|@stack\(['"]content/;
const EXTENDS = /@extends\b|@component\b|<x-[\w.-]*(?:layout|app|guest|page)[\w.-]*|<Layout\b|<AppLayout\b|<MainLayout\b|\{% extends|<svelte:head|definePageMeta/;

export default defineCheck({
  id: ID,
  title: 'One h1 and no skipped heading levels per screen',
  noUiReason: 'no page templates found',
  applies: (repo) => templates(repo).some((t) => isScreenTemplate(t.rel) || t.isDocument),
  measure(repo) {
    const findings = [];
    let measured = 0;
    let ok = 0;
    let unknown = 0;
    for (const t of templates(repo)) {
      if (!(isScreenTemplate(t.rel) || t.isDocument)) continue;
      if (LAYOUT.test(t.source) || /(?:^|\/)layouts?\//i.test(t.rel)) { unknown += 1; continue; }
      const hs = t.elements.filter((e) => /^h[1-6]$/.test(e.tag) && !e.component && e.attrs.get('aria-hidden')?.value !== 'true');
      const layoutManaged = EXTENDS.test(t.source);
      if (hs.length === 0 && !t.isDocument && layoutManaged) { unknown += 1; continue; }
      if (hs.length === 0 && !t.isDocument) continue; // a fragment
      measured += 1;
      const h1s = hs.filter((h) => h.tag === 'h1');
      let pass = true;
      if (h1s.length === 0) {
        if (layoutManaged) { measured -= 1; unknown += 1; continue; }
        pass = false;
        findings.push({ rule: 'h1-missing', severity: 'minor', level: 'A', criterion: '1.3.1', message: 'The screen has headings but no <h1>.', file: t.rel, line: hs[0]?.line ?? 1, hint: 'Give the screen one <h1> naming the page.' });
      } else if (h1s.length > 1) {
        pass = false;
        findings.push({ rule: 'h1-multiple', severity: 'minor', level: 'A', criterion: '1.3.1', message: `The screen has ${h1s.length} <h1> elements (lines ${h1s.map((h) => h.line).join(', ')}).`, file: t.rel, line: h1s[1].line, hint: 'Keep one <h1> and demote the others.' });
      }
      let prev = null;
      for (const h of hs) {
        const level = Number(h.tag[1]);
        if (prev !== null && level > prev + 1) {
          pass = false;
          findings.push({ rule: 'heading-skip', severity: 'minor', level: 'A', criterion: '1.3.1', message: `Heading level jumps from h${prev} to h${level}.`, file: t.rel, line: h.line, hint: `Use h${prev + 1} here, or restructure the headings.` });
        }
        prev = level;
      }
      if (pass) ok += 1;
    }
    if (measured === 0) return { notMeasured: `no screen with headings could be assessed${unknown ? ` (${unknown} page(s) take their <h1> from a layout, which static analysis cannot see)` : ''}` };
    return {
      value: ok / measured,
      detail: `${ok} of ${measured} screens have exactly one <h1> and no skipped level${unknown ? `; ${unknown} layout(s) and page(s) that rely on a layout were left out because the outline is split between files` : ''}. Headings rendered by components or inserted by scripts are not seen.`,
      findings,
    };
  },
});
