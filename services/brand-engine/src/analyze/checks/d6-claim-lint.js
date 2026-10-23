// d6.claim_lint: generic unsupported-claim patterns in user-facing copy (invented counts and
// percentages, ratings, "enterprise-ready"/"bank-grade", guarantees, licensing and regulatory
// claims, returns and profit claims, superlatives, fake urgency, testimonials with no source,
// countdown timers). A claim backed by an evidence marker that names an existing file is
// reported as info instead.
import { defineCheck } from './_lib/define.js';
import { hasUi, profileFacts } from './_lib/sources.js';
import { CLAIM_RULES, excerpt, policyRulesFor } from './_lib/claims.js';
import { claimScan, markupClaims } from './_lib/copy-scan.js';

const ID = 'd6.claim_lint';
const HINTS = {
  count: 'Remove the figure, read it from the application\'s live data, or cite the source with data-evidence="<path to an evidence file in this repository>".',
  compliance: 'Remove the claim, or cite the current certificate or audit with data-evidence="<path to the evidence file>".',
  authorisation: 'Remove the claim unless the owner supplies the current reference; then cite it with data-evidence="<path>".',
  returns: 'Remove the claim. Outcome, return and performance statements need a cited, current source and must not be presented as likely.',
  superlative: 'State what the product does instead, or cite the comparison with data-evidence="<path>".',
  urgency: 'Remove the urgency or scarcity wording unless it is read from real stock or a real deadline.',
};

const PERCENT_FIGURE = /\b\d[\d,.]*\s?(?:%|\+)/;

export default defineCheck({
  id: ID,
  title: 'Unsupported-claim lint over user-facing copy',
  noUiReason: 'no templates or language files found: nothing user-facing to lint',
  applies: (repo) => hasUi(repo),
  measure(repo, ctx) {
    const facts = profileFacts(ctx.profile);
    const { units, hits } = claimScan(repo);
    const markup = markupClaims(repo);
    if (units.length === 0 && markup.length === 0) return { notMeasured: 'no static user-facing text (template text, attributes or language files) was found to scan' };

    const findings = [];
    const violating = new Set();
    const claimBearing = new Set();
    for (const h of hits) {
      claimBearing.add(h.unit);
      const backed = h.evidence?.exists === true;
      const policy = policyRulesFor(h.rule.category, facts);
      const sev = backed ? 'info' : h.rule.severity;
      if (!backed) violating.add(h.unit);
      let msg = `${backed ? 'Evidenced' : 'Unsupported'} claim (${h.rule.label}): "${excerpt(h.unit.text, h.index, h.length)}".`;
      if (policy.length) msg += ` Claims policy: ${policy.join(', ')}.`;
      if (h.evidence) msg += backed ? ` Evidence marker ${h.evidence.ref} found.` : ` Evidence marker ${h.evidence.ref} names a file that is not in the checkout.`;
      findings.push({ rule: h.rule.id, severity: sev, kind: sev === 'info' ? undefined : h.rule.kind, message: msg, file: h.unit.file, line: h.line, hint: HINTS[h.rule.category] });
    }
    for (const m of markup) {
      const backed = m.evidence?.exists === true;
      const policy = policyRulesFor(m.category, facts);
      const what = m.rule === 'testimonial-no-source' ? `A testimonial (${m.phrase}) with no source: no <cite>, <figcaption>, <footer>, cite or data-source.` : 'A countdown timer, which is an urgency pattern.';
      findings.push({
        rule: m.rule,
        severity: backed ? 'info' : 'major',
        kind: backed ? undefined : 'unsupported_claim',
        message: `${what}${policy.length ? ` Claims policy: ${policy.join(', ')}.` : ''}${m.evidence ? (backed ? ` Evidence marker ${m.evidence.ref} found.` : ` Evidence marker ${m.evidence.ref} names a file that is not in the checkout.`) : ''}`,
        file: m.file,
        line: m.line,
        hint: m.rule === 'testimonial-no-source' ? 'Attribute the testimonial to a real, named source (cite/figcaption) with permission, or remove it.' : HINTS.urgency,
      });
      claimBearing.add(`${m.file}:${m.line}`);
      if (!backed) violating.add(`${m.file}:${m.line}`);
    }
    for (const u of units) if (PERCENT_FIGURE.test(u.text)) claimBearing.add(u);

    const total = claimBearing.size;
    const bad = violating.size;
    const policyIdsMapped = new Set(CLAIM_RULES.flatMap((r) => policyRulesFor(r.category, facts)));
    const unmapped = facts.forbidden.filter((r) => !policyIdsMapped.has(r.id)).map((r) => r.id);
    const value = total === 0 ? 1 : (total - bad) / total;
    return {
      value,
      detail: `${units.length} user-facing string(s) scanned; ${total} carry a claim or figure and ${bad} of them are unsupported${total === 0 ? ' (none found: this is the absence of a violation, not proof of accuracy)' : ''}. ${facts.present ? `Profile ${facts.id}: ${facts.forbidden.length} claims_policy rule(s), ${unmapped.length} with no pattern detector (${unmapped.slice(0, 6).join(', ') || 'none'}).` : 'No profile was resolved, so only the generic patterns ran.'}`,
      findings,
    };
  },
});
