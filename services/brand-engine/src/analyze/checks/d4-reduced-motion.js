// d4.reduced_motion: every animation or transition declared in CSS or by a Tailwind utility is disabled
// or reduced under prefers-reduced-motion. A global override (a `*` or html/:root rule inside
// @media (prefers-reduced-motion: reduce) that zeroes durations, animation or transition) covers everything.
// Otherwise a declaration is covered when a reduced-motion rule names the same selector, or it sits in
// @media (prefers-reduced-motion: no-preference), or (utilities) it carries a motion-safe:/motion-reduce: variant.
import { defineCheck } from './_lib/define.js';
import { stylesheets, templates, hasUi } from './_lib/sources.js';
import { splitTop } from './_lib/css.js';

const ID = 'd4.reduced_motion';
const REDUCE = /prefers-reduced-motion\s*:\s*reduce/i;
const NO_PREF = /prefers-reduced-motion\s*:\s*no-preference/i;
const GLOBAL_SEL = /^(?:\*|\*::?before|\*::?after|html|:root|body)$/;
const MOTION_PROPS = new Set(['animation', 'animation-name', 'transition', 'transition-property', 'scroll-behavior']);
const zeroish = (v) => /^(?:none|0(?:s|ms)?|0?\.0*1ms|auto)\b/i.test(v.trim()) || /\b0(?:s|ms)\b|\.0*1ms/.test(v);

function isMotion(d) {
  if (!MOTION_PROPS.has(d.prop)) return false;
  const v = d.value.trim();
  if (/^(?:none|initial|inherit|unset)$/i.test(v)) return false;
  if (d.prop === 'scroll-behavior') return /^smooth$/i.test(v);
  if (d.prop === 'transition' || d.prop === 'animation') return !/^0(?:s|ms)?$/.test(v) && !/^[\w-]+\s+0(?:s|ms)\b(?!.*\d)/.test(v);
  return true;
}

const TW_MOTION = /^(?:animate-(?!none)[\w-]+|transition(?:-(?!none)[\w-]+)?)$/;

export default defineCheck({
  id: ID,
  title: 'Animations and transitions respect prefers-reduced-motion (static)',
  applies: (repo) => hasUi(repo),
  measure(repo) {
    const sheets = stylesheets(repo);
    let globalOverride = false;
    const reducedSelectors = new Set();
    for (const s of sheets) {
      for (const r of s.rules) {
        if (!r.at.some((a) => REDUCE.test(a))) continue;
        const reduces = r.decls.some((d) => (MOTION_PROPS.has(d.prop) || /^(?:animation|transition)-(?:duration|delay|iteration-count)$/.test(d.prop)) && zeroish(d.value));
        if (!reduces) continue;
        for (const p of splitTop(r.selector, ',').map((x) => x.trim())) {
          reducedSelectors.add(p);
          if (GLOBAL_SEL.test(p)) globalOverride = true;
        }
      }
    }

    const findings = [];
    const declared = []; // {file,line,selector,infinite,covered}
    for (const s of sheets) {
      for (const r of s.rules) {
        if (r.keyframes || r.fontFace) continue;
        if (r.at.some((a) => REDUCE.test(a))) continue;
        const inNoPref = r.at.some((a) => NO_PREF.test(a));
        const seenProps = new Set();
        for (const d of r.decls) {
          if (!isMotion(d)) continue;
          const key = d.prop.startsWith('animation') ? 'animation' : d.prop.startsWith('transition') ? 'transition' : d.prop;
          if (seenProps.has(key)) continue;
          seenProps.add(key);
          const parts = splitTop(r.selector, ',').map((x) => x.trim());
          const covered = globalOverride || inNoPref || parts.every((p) => reducedSelectors.has(p));
          declared.push({ file: s.file, line: d.line, selector: r.selector.replace(/\s+/g, ' ').slice(0, 50), kind: key, infinite: /\binfinite\b/.test(d.value), covered });
        }
      }
    }
    // utilities
    const utilityUncovered = [];
    let utilityTotal = 0;
    for (const t of templates(repo)) {
      for (const el of t.elements) {
        const cls = el.attrs.get('class');
        if (!cls) continue;
        const tokens = cls.value.split(/\s+/).filter(Boolean);
        const motion = tokens.filter((x) => TW_MOTION.test(x));
        if (!motion.length) continue;
        utilityTotal += 1;
        const covered = globalOverride || tokens.some((x) => x.startsWith('motion-reduce:')) || cls.value.includes('\u0001');
        if (!covered) utilityUncovered.push({ file: t.rel, line: el.line, classes: motion.slice(0, 2).join(' ') });
      }
    }

    const total = declared.length + utilityTotal;
    const uncovered = declared.filter((d) => !d.covered);
    // findings: loud ones one by one, plain transitions once per file
    for (const d of uncovered.filter((x) => x.infinite || x.kind === 'scroll-behavior')) {
      findings.push({ rule: 'motion-no-reduced-variant', severity: 'major', level: 'AAA', criterion: '2.3.3', message: `${d.infinite ? 'An infinite animation' : 'Smooth scrolling'} on "${d.selector}" has no prefers-reduced-motion override.`, file: d.file, line: d.line, hint: 'Add @media (prefers-reduced-motion: reduce) { ... animation: none } for it, or a global override.' });
    }
    const perFile = new Map();
    for (const d of uncovered.filter((x) => !x.infinite && x.kind !== 'scroll-behavior')) {
      if (!perFile.has(d.file)) perFile.set(d.file, []);
      perFile.get(d.file).push(d);
    }
    for (const [file, list] of perFile) {
      findings.push({ rule: 'motion-no-reduced-variant', severity: 'minor', level: 'AAA', criterion: '2.3.3', message: `${list.length} transition/animation declaration(s) have no prefers-reduced-motion override; first: "${list[0].selector}".`, file, line: list[0].line, hint: 'Add one global @media (prefers-reduced-motion: reduce) rule that shortens transitions and animations, or per-selector overrides.' });
    }
    for (const u of utilityUncovered) {
      findings.push({ rule: 'motion-utility-no-variant', severity: 'minor', level: 'AAA', criterion: '2.3.3', message: `Utility class "${u.classes}" animates with no motion-reduce: variant and no global override.`, file: u.file, line: u.line, hint: 'Add motion-reduce:transition-none / motion-reduce:animate-none, or a global reduced-motion rule.' });
    }

    const covered = total - uncovered.length - utilityUncovered.length;
    return {
      value: total === 0 ? 1 : covered / total,
      detail: total === 0
        ? 'no animation, transition or smooth scrolling declared in the scanned stylesheets or utility classes, so there is nothing to reduce.'
        : `${covered} of ${total} motion declarations are covered by prefers-reduced-motion (${globalOverride ? 'a global override exists' : 'no global override'}); utility classes counted per element. Motion from JavaScript is not scanned.`,
      findings,
    };
  },
});
