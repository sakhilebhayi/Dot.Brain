// FIXTURE check module (not the real d8.token_pair_contrast). It reads --text on --bg and
// --on-accent on --accent from src/tokens.css and applies the WCAG 2.2 AA ratio of 4.5:1.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const PAIRS = [['--text', '--bg'], ['--on-accent', '--accent']];

export default {
  id: 'd8.token_pair_contrast',
  dimension: 'accessibility_inclusion',
  title: 'Token pair contrast (fixture)',
  appliesTo: (ctx) => ctx.files.exists('src/tokens.css'),
  run(ctx) {
    const css = ctx.files.read('src/tokens.css') ?? '';
    const lines = css.split('\n');
    const value = (name) => {
      const i = lines.findIndex((l) => l.includes(`${name}:`));
      return i === -1 ? null : { hex: /#[0-9a-fA-F]{6}/.exec(lines[i])?.[0], line: i + 1 };
    };
    let pass = 0;
    const findings = [];
    for (const [fg, bg] of PAIRS) {
      const f = value(fg);
      const b = value(bg);
      if (!f?.hex || !b?.hex) continue;
      const r = ratio(f.hex, b.hex);
      if (r >= 4.5) pass += 1;
      else {
        findings.push({
          id: `contrast-${fg}`, severity: 'blocker', dimension: 'accessibility_inclusion', check_id: 'd8.token_pair_contrast',
          message: `Token pair ${fg} on ${bg} has contrast ${r.toFixed(2)}:1; AA needs 4.5:1`,
          location: { file: 'src/tokens.css', line: f.line },
          fix_hint: 'Darken the foreground token (or lighten the background) until the pair reaches 4.5:1.',
          kind: 'wcag_failure', wcag_level: 'AA', wcag_criterion: '1.4.3',
        });
      }
    }
    return {
      status: 'measured',
      evidence: [{ check_id: 'd8.token_pair_contrast', source_class: 'automated_check', result: pass / PAIRS.length, detail: `${pass} of ${PAIRS.length} token pairs meet 4.5:1 (themes evaluated: ${ctx.themes.join(', ')}; the fixture reads one set of tokens)`, artifact_ref: 'src/tokens.css' }],
      findings,
    };
  },
};
