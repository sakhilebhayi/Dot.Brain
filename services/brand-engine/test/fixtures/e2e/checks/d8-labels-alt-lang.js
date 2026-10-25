// FIXTURE check module (not the real d8.labels_alt_lang): images need alt text; the page needs a lang.
export default {
  id: 'd8.labels_alt_lang',
  dimension: 'accessibility_inclusion',
  title: 'Labels, alt text and language (fixture)',
  appliesTo: (ctx) => ctx.files.list('public/**/*.html').length > 0,
  run(ctx) {
    let ok = 0;
    let total = 0;
    const findings = [];
    for (const file of ctx.files.list('public/**/*.html')) {
      const lines = (ctx.files.read(file) ?? '').split('\n');
      total += 1;
      if (/<html[^>]*\blang=/.test(lines.join('\n'))) ok += 1;
      else findings.push({ id: `lang-${file}`, severity: 'blocker', dimension: 'accessibility_inclusion', check_id: 'd8.labels_alt_lang', message: 'The page has no lang attribute', location: { file, line: 1 }, fix_hint: 'Add a lang attribute to the html element.', kind: 'wcag_failure', wcag_level: 'A', wcag_criterion: '3.1.1' });
      lines.forEach((l, i) => {
        for (const m of l.matchAll(/<img\b[^>]*>/g)) {
          total += 1;
          if (/\balt=/.test(m[0])) ok += 1;
          else findings.push({ id: `alt-${file}-${i + 1}`, severity: 'blocker', dimension: 'accessibility_inclusion', check_id: 'd8.labels_alt_lang', message: `An image has no alt text: ${/src="([^"]*)"/.exec(m[0])?.[1] ?? '(no src)'}`, location: { file, line: i + 1 }, fix_hint: 'Add an alt attribute that says what the image shows (alt="" if it is decorative).', kind: 'wcag_failure', wcag_level: 'A', wcag_criterion: '1.1.1' });
        }
      });
    }
    return { status: 'measured', evidence: [{ check_id: 'd8.labels_alt_lang', source_class: 'automated_check', result: total === 0 ? 1 : ok / total, detail: `${ok} of ${total} images and pages carry alt text or a language`, artifact_ref: 'public/' }], findings };
  },
};
