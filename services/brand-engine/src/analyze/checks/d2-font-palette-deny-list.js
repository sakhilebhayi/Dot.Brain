// d2.font_palette_deny_list: share of the fonts (primary family of each font stack) that are not on a
// deny-list of generic defaults. The list is the profile's visual_direction.prohibited entries (matched by
// font NAME, whole word, case-insensitive) plus a small built-in list of fonts that ship as browser, OS or
// starter-kit defaults. Palette values are checked only against hex colours written in the profile's
// prohibited entries; with none, the palette is not evaluated and the detail says so.
import { defineCheck } from './_lib/define.js';
import { designDoc, hasUi, profileFacts } from './_lib/sources.js';
import { tokenFacts } from './_lib/tokens.js';

const ID = 'd2.font_palette_deny_list';
// Fonts that arrive as a default somewhere (browser, OS, framework starter): choosing one is not a decision.
export const GENERIC_FONTS = ['arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'segoe ui', 'roboto', 'inter', 'open sans', 'lato', 'montserrat', 'poppins', 'figtree', 'instrument sans', 'nunito'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, name) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

export default defineCheck({
  id: ID,
  title: 'Fonts and palette against the deny-list of generic defaults',
  applies: (repo) => hasUi(repo),
  measure(repo, ctx) {
    const facts = profileFacts(ctx.profile);
    const tf = tokenFacts(repo);
    const used = new Map(); // lower name -> first use
    for (const f of tf.fonts) {
      if (f.generic || f.declaredOnly) continue;
      const key = f.family.toLowerCase();
      if (!used.has(key)) used.set(key, f);
    }
    const prohibitedHex = new Set(facts.prohibited.flatMap((t) => [...t.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => m[0].toLowerCase())));
    const palette = [...tf.colour.values.keys()].filter((h) => !h.includes('@'));

    const findings = [];
    let items = 0;
    let ok = 0;
    for (const [key, f] of [...used].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      items += 1;
      const byProfile = facts.prohibited.find((t) => mentions(t, f.family));
      const builtin = GENERIC_FONTS.includes(key);
      if (byProfile || builtin) {
        findings.push({
          rule: 'font-on-deny-list', severity: byProfile ? 'major' : 'minor',
          message: byProfile ? `The font "${f.family}" is named in the profile's prohibited list.` : `The font "${f.family}" is a browser, OS or starter-kit default (${f.source}), not a chosen typeface.`,
          file: f.file, line: f.line,
          hint: 'Choose a typeface that the product\'s DESIGN.md records, or record why this one is the right choice.',
        });
      } else ok += 1;
    }
    // Fonts the product's DESIGN.md declares (front matter typography.*.fontFamily); a used font outside that set is reported
    // without changing the share, since the rubric's share is about the deny-list.
    const design = designDoc(repo);
    const declaredFonts = new Set(Object.values(design?.front?.typography ?? {})
      .map((t) => (t && typeof t === 'object' && typeof t.fontFamily === 'string' ? t.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase() : null))
      .filter(Boolean));
    if (declaredFonts.size) {
      for (const [key, f] of [...used].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (!declaredFonts.has(key)) findings.push({ rule: 'font-not-declared', severity: 'minor', message: `The font "${f.family}" is used but ${design.rel} declares ${[...declaredFonts].slice(0, 4).join(', ')}.`, file: f.file, line: f.line, hint: 'Declare the font in DESIGN.md or use a declared one.' });
      }
    }
    let paletteNote = 'the profile writes no hex colour in its prohibited list, so the palette was not evaluated';
    if (prohibitedHex.size) {
      for (const hex of palette) {
        items += 1;
        if (prohibitedHex.has(hex)) {
          const w = tf.colour.values.get(hex);
          findings.push({ rule: 'palette-on-deny-list', severity: 'major', message: `The colour ${hex} is listed as prohibited in the profile.`, file: w.file, line: w.line, hint: 'Replace it with a colour from the product\'s own palette.' });
        } else ok += 1;
      }
      paletteNote = `${palette.length} distinct colour value(s) were checked against ${prohibitedHex.size} prohibited hex value(s)`;
    }
    if (items === 0) return { notMeasured: 'no named font family was found (only generic keywords or none), and no palette deny-list is available' };
    return {
      value: ok / items,
      detail: `${ok} of ${items} fonts/palette values are off the deny-list. Fonts found: ${[...used.values()].map((f) => f.family).slice(0, 8).join(', ') || 'none'}; ${paletteNote}. Matching is by name only.`,
      findings,
    };
  },
});
