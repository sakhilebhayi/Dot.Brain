// d4.spacing_type_scale_conformance: share of spacing (margin, padding, gap) and font-size values that sit
// on the product's declared scales: a var() reference, or a literal equal to a value of a declared spacing or
// type scale token (custom properties named like --space-*, --spacing-*, --text-*, --font-size-*, or the
// spacing/typography tables of DESIGN.md front matter). With no declared scale the check is not_measured:
// the default scale of a framework is not the product's declared scale.
import { defineCheck } from './_lib/define.js';
import { hasUi, stylesheets } from './_lib/sources.js';
import { tokenFacts } from './_lib/tokens.js';

const ID = 'd4.spacing_type_scale_conformance';
const near = (set, px) => [...set].some((v) => Math.abs(v - px) < 0.01);

export default defineCheck({
  id: ID,
  title: 'Spacing and type size on the declared scales',
  applies: (repo) => hasUi(repo),
  measure(repo) {
    const tf = tokenFacts(repo);
    const haveSpace = tf.spacingScale.size > 0;
    const haveType = tf.typeScale.size > 0;
    if (!haveSpace && !haveType) {
      const first = stylesheets(repo)[0]?.file ?? 'DESIGN.md';
      return {
        notMeasured: 'no spacing or type scale is declared (no --space-*, --spacing-*, --text-*, --font-size-* custom properties and no spacing/typography in DESIGN.md front matter), so there is nothing to conform to',
        findings: [{ rule: 'no-scale-declared', severity: 'info', message: 'No spacing scale and no type scale are declared as tokens, so spacing and type size cannot be checked for consistency.', file: first, line: 1, hint: 'Declare the scales as custom properties (--space-1.., --text-sm..) or in the DESIGN.md spacing and typography tables.' }],
      };
    }
    const items = tf.spacing.filter((s) => (s.kind === 'spacing' ? haveSpace : haveType));
    if (items.length === 0) return { notMeasured: 'a scale is declared but no spacing or font-size value was found to compare against it' };
    let ok = 0;
    const off = new Map();
    for (const it of items) {
      const scale = it.kind === 'spacing' ? tf.spacingScale : tf.typeScale;
      if (it.token || (it.px !== null && near(scale, it.px))) ok += 1;
      else {
        if (!off.has(it.file)) off.set(it.file, []);
        off.get(it.file).push(it);
      }
    }
    const findings = [];
    for (const [file, list] of [...off].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      findings.push({
        rule: 'off-scale-value', severity: 'minor',
        message: `${list.length} spacing or font-size value(s) are not on the declared scale; first: ${list[0].raw} (${list[0].kind}).`,
        file, line: list[0].line,
        hint: 'Use a scale token (var(--space-*) or var(--text-*)) or add the value to the scale on purpose.',
      });
    }
    return {
      value: ok / items.length,
      detail: `${ok} of ${items.length} spacing/font-size values are tokens or on a declared scale (${haveSpace ? `${tf.spacingScale.size} spacing step(s)` : 'no spacing scale'}, ${haveType ? `${tf.typeScale.size} type step(s)` : 'no type scale'}); values for an undeclared scale are not assessed. calc()/clamp() with var() count as tokens.`,
      findings,
    };
  },
});
