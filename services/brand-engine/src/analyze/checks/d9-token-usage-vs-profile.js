// d9.token_usage_vs_profile: of the colour, font and spacing/type-size values used in stylesheets, inline
// styles, SVG attributes and utility classes, the share that come from declared design tokens (var(--x) whose
// --x is declared, or a utility class bound to a theme colour) rather than hard-coded literals or the
// framework's default palette. Custom-property definitions are not usages. Also reports near-identical
// colour literals and var() references to tokens that are declared nowhere in the checkout.
import { defineCheck } from './_lib/define.js';
import { hasUi, profileFacts } from './_lib/sources.js';
import { tokenFacts } from './_lib/tokens.js';
import { parseColor } from './_lib/color.js';

const ID = 'd9.token_usage_vs_profile';
const MAX_NEAR = 15;

export default defineCheck({
  id: ID,
  title: "Values drawn from design tokens rather than hard-coded",
  applies: (repo) => hasUi(repo),
  measure(repo, ctx) {
    const facts = profileFacts(ctx.profile);
    const tf = tokenFacts(repo);
    const c = tf.colour;
    const fontsUsed = tf.fonts.filter((f) => !f.declaredOnly);
    const spacingTok = tf.spacing.filter((s) => s.token).length;
    const spacingLit = tf.spacing.filter((s) => !s.token).length;

    const tokens = c.token + spacingTok;
    const nonTokens = c.literal + c.framework + spacingLit;
    const total = tokens + nonTokens;
    if (total === 0) return { notMeasured: 'no colour, font-size or spacing values were found in the scanned stylesheets, inline styles or utility classes' };

    const findings = [];
    for (const [file, list] of [...c.literalsByFile].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const tok = c.tokenByFile.get(file) ?? 0;
      findings.push({
        rule: 'hardcoded-colours',
        severity: list.length >= 5 ? 'minor' : 'info',
        message: `${list.length} hard-coded colour literal(s) against ${tok} token reference(s); first: ${list[0].text}.`,
        file, line: list[0].line,
        hint: 'Declare the colour as a design token (a custom property) and reference it with var(--name).',
      });
    }
    for (const [name, where] of [...tf.undefinedTokens].sort()) {
      findings.push({ rule: 'undefined-token', severity: 'minor', message: `var(${name}) is used but ${name} is not declared in any scanned stylesheet.`, file: where.file, line: where.line, hint: 'Declare the token, fix the name, or give var() a fallback and document where it comes from.' });
    }

    // near-identical literals (distinct values within a few units per channel)
    const distinct = [...c.values].filter(([hex]) => !hex.includes('@'));
    const near = [];
    for (let i = 0; i < distinct.length && near.length < MAX_NEAR; i += 1) {
      for (let j = i + 1; j < distinct.length && near.length < MAX_NEAR; j += 1) {
        const a = parseColor(distinct[i][0]);
        const b = parseColor(distinct[j][0]);
        const d = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
        if (d > 0 && d <= 6) near.push([distinct[i], distinct[j], d]);
      }
    }
    for (const [[hexA, wa], [hexB, wb], d] of near) {
      findings.push({ rule: 'near-duplicate-colours', severity: 'minor', message: `Colour literals ${hexA} (${wa.file}:${wa.line}) and ${hexB} (${wb.file}:${wb.line}) differ by at most ${d}/255 per channel.`, file: wb.file, line: wb.line, hint: 'Use one token for both, or make the difference deliberate and visible.' });
    }

    const cited = facts.sourceRefs.filter((r) => r.role === 'token_source');
    const citedMissing = cited.filter((r) => !repo.exists(r.path)).map((r) => r.path);
    return {
      value: tokens / total,
      detail: `${tokens} of ${total} values come from tokens: colour ${c.token} token / ${c.literal} literal / ${c.framework} framework-default utility; spacing and type size ${spacingTok} token / ${spacingLit} literal; ${fontsUsed.length} font-family declaration(s) not counted. ${cited.length ? `The profile cites ${cited.length} token source(s)${citedMissing.length ? `, ${citedMissing.length} not in this checkout (${citedMissing.join(', ').slice(0, 120)})` : ', all present'}.` : 'The profile cites no token source, so any declared custom property counts.'}`,
      findings,
    };
  },
});
