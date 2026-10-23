// d6.privacy_terms_present: for each of a privacy notice and terms, three things: it exists (a route or a view
// or a static page), it is not a placeholder (enough real words, no lorem/TODO/"coming soon"), and it is linked
// from a layout, footer or partial that public pages share. The share is out of six. A route whose view cannot
// be found is counted as present but its content is not judged (it is not counted as real).
import { defineCheck } from './_lib/define.js';
import { templates, copyUnits } from './_lib/sources.js';
import { routeTable } from './_lib/routes.js';
import { DYN } from './_lib/markup.js';

const ID = 'd6.privacy_terms_present';
const DOCS = [
  { key: 'privacy', label: 'privacy notice', re: /privacy/i },
  { key: 'terms', label: 'terms', re: /terms|conditions|\btos\b/i },
];
const STUB = /\blorem\s+ipsum\b|\b(?:TODO|FIXME|TBD)\b|\bcoming\s+soon\b|\bplaceholder\b|\byour\s+(?:company|business)\s+name\b/i;
const MIN_WORDS = 80;
const SHARED = /(?:^|\/)(?:layouts?|components?|partials?|includes?|footer|nav|header)[^/]*$|(?:^|\/)(?:layouts?|components?|partials?|includes?)\//i;

const viewName = (rel) => /^resources\/views\/(.+)\.blade\.php$/.exec(rel)?.[1]?.replaceAll('/', '.') ?? null;

export default defineCheck({
  id: ID,
  title: 'Privacy notice and terms present, real and linked',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const tpls = templates(repo);
    const table = routeTable(repo);
    const units = copyUnits(repo);
    const findings = [];
    let got = 0;
    let unjudged = 0;

    for (const d of DOCS) {
      // existence
      const route = table.routes.find((r) => d.re.test(r.path) || (r.name && d.re.test(r.name)));
      const tpl = tpls.find((t) => d.re.test(t.rel.split('/').pop().replace(/\.blade\.php$|\.\w+$/, '')) && !SHARED.test(t.rel))
        ?? (route?.view ? tpls.find((t) => viewName(t.rel) === route.view) : undefined);
      const present = Boolean(route || tpl);
      if (!present) {
        findings.push({ rule: `${d.key}-missing`, severity: 'major', message: `No ${d.label} page was found (no route, view or static page named like "${d.key}").`, file: 'resources/views', line: 1, hint: `Publish a real ${d.label} and link it from the footer.` });
        continue;
      }
      got += 1;

      // real
      if (tpl) {
        const text = units.filter((u) => u.file === tpl.rel).map((u) => u.text).join(' ').replaceAll(DYN, ' ');
        const wordCount = (text.match(/[\p{L}]{2,}/gu) ?? []).length;
        const dynamicBody = /\{!!\s*\$|\$(?:terms|policy|content|body|html)\b|<x-markdown|@markdown/.test(tpl.source);
        if (dynamicBody && !STUB.test(text)) unjudged += 1;
        else if (STUB.test(text) || wordCount < MIN_WORDS) {
          findings.push({ rule: `${d.key}-placeholder`, severity: 'major', message: `The ${d.label} page looks like a placeholder: ${STUB.test(text) ? 'it contains stub wording' : `${wordCount} words of static text (fewer than ${MIN_WORDS})`}.`, file: tpl.rel, line: 1, hint: `Write the real ${d.label}; if the text is rendered from the database, this finding is a false positive.` });
        } else got += 1;
      }

      // linked from something shared
      const linked = tpls.some((t) => (SHARED.test(t.rel) || t.isDocument) && t.elements.some((e) => {
        if (e.tag !== 'a') return false;
        const h = e.attrs.get('href');
        if (!h) return false;
        return d.re.test(h.value) || h.exprs.some((x) => d.re.test(x));
      }));
      if (linked) got += 1;
      else findings.push({ rule: `${d.key}-not-linked`, severity: 'minor', message: `No link to the ${d.label} was found in a layout, footer or shared partial.`, file: tpl?.rel ?? route?.file, line: tpl ? 1 : (route?.line ?? 1), hint: `Link the ${d.label} from the footer so every public page reaches it.` });
    }
    return {
      value: got / 6,
      detail: `${got} of 6 conditions hold (privacy and terms: present, not a placeholder, linked from shared markup). "Reachable from every public page" is approximated by a link in a layout, footer or partial; content served from a database or a CMS is not seen${unjudged ? ` (${unjudged} page body/bodies rendered from a variable were not judged and earn no credit)` : ''}.`,
      findings,
    };
  },
});
