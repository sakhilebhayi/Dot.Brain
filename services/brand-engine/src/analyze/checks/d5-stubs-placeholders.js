// d5.stubs_placeholders: share of shipped surfaces (user-facing templates with static text) free of visible
// stub text: lorem ipsum, TODO/FIXME/TBD, "placeholder text", "your text here", "not implemented", "coming soon",
// "under construction". "Coming soon" can be an honest label for a feature that is not built, so it is a
// minor finding; it still counts the surface as having a stub. TODO notes in comments are info and do not
// count against the share (a visitor never sees them).
import { defineCheck } from './_lib/define.js';
import { copyUnits, templates } from './_lib/sources.js';
import { excerpt } from './_lib/claims.js';
import { lineInUnit } from './_lib/sources.js';
import { routeTable } from './_lib/routes.js';

const ID = 'd5.stubs_placeholders';
const PATTERNS = [
  { id: 'lorem-ipsum', re: /\blorem\s+ipsum\b/gi, severity: 'major', what: 'lorem ipsum filler text' },
  { id: 'todo-marker', re: /\b(?:TODO|FIXME|TBD|TBC|XXX)\b/g, severity: 'major', what: 'a TODO/FIXME/TBD marker' },
  { id: 'placeholder-text', re: /\b(?:placeholder\s+(?:text|content|image|copy)|sample\s+(?:text|content|copy)|your\s+(?:text|content|title|description|headline)\s+here|insert\s+(?:text|content)\s+here|click\s+here\s+to\s+edit)\b/gi, severity: 'major', what: 'placeholder text' },
  { id: 'not-implemented', re: /\bnot\s+(?:yet\s+)?implemented\b|\bunder\s+development\b/gi, severity: 'major', what: 'a not-implemented notice' },
  { id: 'coming-soon', re: /\bcoming\s+soon\b|\bunder\s+construction\b|\bwork\s+in\s+progress\b/gi, severity: 'minor', what: 'a "coming soon" or "under construction" notice' },
];

const viewName = (rel) => {
  const m = /^resources\/views\/(.+)\.blade\.php$/.exec(rel);
  return m ? m[1].replaceAll('/', '.') : null;
};

export default defineCheck({
  id: ID,
  title: 'No stub or placeholder content on shipped surfaces',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const units = copyUnits(repo).filter((u) => u.source !== 'lang');
    const byFile = new Map();
    for (const u of units) { if (!byFile.has(u.file)) byFile.set(u.file, []); byFile.get(u.file).push(u); }
    if (byFile.size === 0) return { notMeasured: 'no static user-facing text was found in the templates' };
    const live = new Map(routeTable(repo).routes.filter((r) => r.view).map((r) => [r.view, r.path]));
    const findings = [];
    let clean = 0;
    for (const [file, list] of [...byFile].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      let stub = false;
      for (const u of list) {
        for (const p of PATTERNS) {
          p.re.lastIndex = 0;
          for (let m = p.re.exec(u.text); m; m = p.re.exec(u.text)) {
            stub = true;
            const route = live.get(viewName(file) ?? '');
            findings.push({
              rule: p.id, severity: p.severity,
              message: `${p.what[0].toUpperCase()}${p.what.slice(1)}: "${excerpt(u.text, m.index, m[0].length)}"${route ? ` (this view is served at ${route})` : ''}.`,
              file, line: lineInUnit(u, m.index),
              hint: p.id === 'coming-soon' ? 'If the feature is not built, say so plainly and do not link to it; otherwise remove the notice.' : 'Replace it with real content or remove the surface.',
            });
          }
        }
      }
      if (!stub) clean += 1;
    }
    for (const t of templates(repo)) {
      for (const c of t.comments) {
        if (/\b(?:TODO|FIXME|XXX)\b/.test(c.text)) findings.push({ rule: 'todo-comment', severity: 'info', message: 'A TODO/FIXME note in a template comment (not visible to visitors).', file: t.rel, line: c.line, hint: 'Resolve it or move it to the issue tracker.' });
      }
    }
    return {
      value: clean / byFile.size,
      detail: `${clean} of ${byFile.size} surfaces with static text are free of visible stub content. Surfaces whose text is all dynamic, and text produced by scripts, are not seen.`,
      findings,
    };
  },
});
