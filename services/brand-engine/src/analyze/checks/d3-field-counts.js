// d3.field_counts: share of <form> elements whose visible field count is within a bound. Fields are
// text-like inputs, checkboxes, radio groups (counted once per name), selects and textareas; hidden
// inputs and buttons are ignored. Form fields rendered by components are counted only when the component
// tag names an input, select or textarea. Whether a form asks for something the task does not need is
// not statically knowable and is not measured. The bound is an engine default (8) unless the caller passes
// ctx.options.max_fields_per_form.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { descendants } from './_lib/markup.js';

const ID = 'd3.field_counts';
export const DEFAULT_BOUND = 8;
const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const COMPONENT_FIELD = /^x-(?:[\w.-]*[-.])?(?:input|select|textarea|checkbox|radio|field)(?:[-.][\w.-]*)?$/i;
const NOT_FIELD = /(?:label|error|help|hint|group|wrapper)/i;

export default defineCheck({
  id: ID,
  title: 'Fields per form',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo, ctx) {
    const bound = Number.isInteger(ctx?.options?.max_fields_per_form) ? ctx.options.max_fields_per_form : DEFAULT_BOUND;
    const declared = Number.isInteger(ctx?.options?.max_fields_per_form);
    const findings = [];
    let forms = 0;
    let ok = 0;
    for (const t of templates(repo)) {
      for (const form of t.elements.filter((e) => e.tag === 'form' && !e.component)) {
        let count = 0;
        const radios = new Set();
        for (const n of descendants(form)) {
          if (n.type !== 'el') continue;
          if (n.component) { if (COMPONENT_FIELD.test(n.rawTag) && !NOT_FIELD.test(n.rawTag)) count += 1; continue; }
          if (n.tag === 'input') {
            const type = (n.attrs.get('type')?.value ?? 'text').toLowerCase();
            if (SKIP.has(type)) continue;
            if (type === 'radio') radios.add(n.attrs.get('name')?.value ?? `#${n.line}`);
            else count += 1;
          } else if (n.tag === 'select' || n.tag === 'textarea') count += 1;
        }
        count += radios.size;
        if (count === 0) continue;
        forms += 1;
        if (count <= bound) ok += 1;
        else findings.push({ rule: 'form-too-many-fields', severity: 'minor', message: `A form has ${count} fields (bound ${bound}).`, file: t.rel, line: form.line, hint: 'Ask only for what the task needs now; split the form or make fields optional.' });
      }
    }
    if (forms === 0) return { notMeasured: 'no <form> with fields was found in the templates' };
    return {
      value: ok / forms,
      detail: `${ok} of ${forms} forms have at most ${bound} fields (${declared ? 'bound supplied by the caller' : 'engine default bound; the profile declares none'}). Whether each field is needed is not measured.`,
      findings,
    };
  },
});
