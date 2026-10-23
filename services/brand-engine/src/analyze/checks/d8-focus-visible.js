// d8.focus_visible: the static part of "visible focus indicator and logical focus order":
//   * CSS that removes the outline (outline: none / 0) with no replacement for the same selector,
//   * Tailwind outline-none / focus:outline-none with no focus ring, shadow or border in the class list,
//   * tabindex greater than 0.
// Absence of these is what the result measures; it does not prove a focus indicator is visible, which needs
// a rendered page. Each removal that has a replacement counts as ok.
import { defineCheck } from './_lib/define.js';
import { stylesheets, templates, hasUi } from './_lib/sources.js';
import { splitTop } from './_lib/css.js';

const ID = 'd8.focus_visible';
const SUPPRESS = (d) => (d.prop === 'outline' && /^(?:none|0)(?:\s|$)/i.test(d.value))
  || (d.prop === 'outline-style' && /^none\b/i.test(d.value))
  || (d.prop === 'outline-width' && /^0(?:px|rem|em)?$/i.test(d.value));
const FOCUS_PSEUDO = /:(?:focus-visible|focus-within|focus)(?![\w-])/g;
const SAFE = /:not\(\s*:focus-visible\s*\)/i;
const NON_INTERACTIVE_BASE = /^(?:main|h[1-6]|body|html|:root|\[tabindex=["']?-1["']?\]|#[\w-]*main[\w-]*|\.sr-only[\w-]*|\.skip[\w-]*|\*::?(?:before|after))$/i;

const baseOf = (sel) => sel.replace(FOCUS_PSEUDO, '').replace(/:(?:hover|active)(?![\w-])/g, '').replace(/\s+/g, ' ').trim() || '*';
const hasIndicator = (rule) => rule.decls.some((d) => (d.prop === 'box-shadow' && !/^none\b/i.test(d.value))
  || /^border(?:-(?:color|width|style|bottom|top|left|right)(?:-color)?)?$/.test(d.prop)
  || (d.prop === 'outline' && !SUPPRESS(d) && !/^none\b/i.test(d.value))
  || (d.prop === 'outline-color')
  || d.prop === 'text-decoration' || d.prop === 'background' || d.prop === 'background-color');

const TW_SUPPRESS = /^(?:(?:focus|focus-visible|focus-within):)?outline-(?:none|hidden)$/;
const TW_REPLACE = /^(?:focus|focus-visible|focus-within):(?:ring|shadow|border|outline-(?!none|hidden)|bg-|underline|decoration|\[)/;

export default defineCheck({
  id: ID,
  title: 'Focus indicators not removed; no positive tabindex (static)',
  applies: (repo) => hasUi(repo),
  measure(repo) {
    const findings = [];
    let items = 0;
    let bad = 0;

    // CSS
    const focusRules = [];
    const sheets = stylesheets(repo);
    for (const s of sheets) {
      for (const r of s.rules) {
        if (r.keyframes || r.fontFace) continue;
        const parts = splitTop(r.selector, ',');
        if (parts.some((p) => /:focus/.test(p))) focusRules.push({ rule: r, bases: parts.filter((p) => /:focus/.test(p)).map(baseOf) });
      }
    }
    for (const s of sheets) {
      for (const r of s.rules) {
        if (r.keyframes || r.fontFace) continue;
        const sup = r.decls.find(SUPPRESS);
        if (!sup) continue;
        const parts = splitTop(r.selector, ',').map((p) => p.trim());
        if (parts.every((p) => SAFE.test(p))) continue;
        const bases = parts.filter((p) => !SAFE.test(p)).map(baseOf);
        if (bases.every((b) => NON_INTERACTIVE_BASE.test(b.split(' ').pop()) || NON_INTERACTIVE_BASE.test(b))) continue;
        items += 1;
        const replaced = hasIndicator(r) || bases.some((b) => focusRules.some((f) => f.rule !== r && f.bases.includes(b) && hasIndicator(f.rule)));
        if (!replaced) {
          bad += 1;
          findings.push({
            rule: 'focus-outline-removed', severity: 'major', level: 'AA', criterion: '2.4.7',
            message: `The outline is removed for "${r.selector.replace(/\s+/g, ' ').slice(0, 60)}" and no box-shadow, border or :focus-visible rule replaces it (WCAG 2.4.7).`,
            file: s.file, line: sup.line,
            hint: 'Keep the default outline, or add a :focus-visible rule with a visible outline or box-shadow of at least 3:1 contrast.',
          });
        }
      }
    }

    // Templates: utility classes and tabindex
    for (const t of templates(repo)) {
      for (const el of t.elements) {
        if (el.component) continue;
        const cls = el.attrs.get('class');
        if (cls) {
          const tokens = cls.value.split(/\s+/).filter(Boolean);
          if (tokens.some((x) => TW_SUPPRESS.test(x))) {
            items += 1;
            if (!(cls.value.includes('\u0001') || tokens.some((x) => TW_REPLACE.test(x)))) {
              bad += 1;
              findings.push({
                rule: 'focus-outline-removed', severity: 'major', level: 'AA', criterion: '2.4.7',
                message: `A <${el.tag}> removes the outline (outline-none) and its class list has no focus ring, shadow or border to replace it (WCAG 2.4.7).`,
                file: t.rel, line: el.line,
                hint: 'Add focus-visible:ring-2 (or an outline) beside outline-none, or drop outline-none.',
              });
            }
          }
        }
        const ti = el.attrs.get('tabindex');
        if (ti && !ti.dynamic && /^\d+$/.test(ti.value.trim()) && Number(ti.value) > 0) {
          items += 1;
          bad += 1;
          findings.push({
            rule: 'tabindex-positive', severity: 'major', level: 'A', criterion: '2.4.3',
            message: `tabindex="${ti.value.trim()}" on a <${el.tag}> forces a custom tab order that rarely matches reading order (WCAG 2.4.3).`,
            file: t.rel, line: el.line,
            hint: 'Use tabindex="0" or -1 and let the DOM order set the focus order.',
          });
        }
      }
    }

    return {
      value: items === 0 ? 1 : (items - bad) / items,
      detail: items === 0
        ? 'no outline removal and no positive tabindex found in the scanned stylesheets and templates; the browser default focus indicator applies. This is the absence of a known defect, not proof of a visible indicator.'
        : `${items - bad} of ${items} outline removals or positive tabindex uses are safe (replaced by a visible indicator); the rest are listed. Rendered focus order and indicator visibility are not measured.`,
      findings,
    };
  },
});
