// d1.copy_profile_language_lint: share of user-facing strings that avoid the resolved profile's
// banned phrases and do not trip a claim pattern. Banned-phrase hits are reported here; the claim
// hits themselves are reported once, by d6.claim_lint, and only counted here.
import { defineCheck } from './_lib/define.js';
import { hasUi, profileFacts } from './_lib/sources.js';
import { excerpt } from './_lib/claims.js';
import { bannedScan, claimScan, markupClaims } from './_lib/copy-scan.js';

export default defineCheck({
  id: 'd1.copy_profile_language_lint',
  title: "Copy against the profile's banned phrases and claims policy",
  noUiReason: 'no templates or language files found: nothing user-facing to lint',
  applies: (repo) => hasUi(repo),
  measure(repo, ctx) {
    const facts = profileFacts(ctx.profile);
    if (!facts.present) return { notMeasured: 'no profile was resolved, so the banned phrases and claims policy are unknown' };
    const { units, hits: banned } = bannedScan(repo, facts.bannedPhrases);
    if (units.length === 0) return { notMeasured: 'no static user-facing text (template text, attributes or language files) was found to scan' };
    const claimHits = claimScan(repo).hits.filter((h) => h.evidence?.exists !== true);
    const markup = markupClaims(repo).filter((m) => m.evidence?.exists !== true);

    const bad = new Set();
    const findings = [];
    for (const b of banned) {
      bad.add(b.unit);
      findings.push({
        rule: 'banned-phrase',
        severity: 'major',
        message: `Banned phrase "${b.phrase}" (profile ${facts.id}) in: "${excerpt(b.unit.text, b.index, b.matched.length)}".`,
        file: b.unit.file,
        line: b.line,
        hint: 'Say plainly what the product does instead; the phrase is on the profile\'s banned list.',
      });
    }
    for (const h of claimHits) bad.add(h.unit);
    const total = units.length + markup.length;
    const failing = bad.size + markup.length;
    return {
      value: (total - failing) / total,
      detail: `${total} user-facing string(s) scanned against ${facts.bannedPhrases.length} banned phrase(s) of profile ${facts.id}${facts.bannedPhrases.length === 0 ? ' (the profile lists none)' : ''}; ${bad.size} string(s) trip a banned phrase or an unsupported-claim pattern${markup.length ? ` and ${markup.length} markup claim(s)` : ''} (claim hits are listed under d6.claim_lint).`,
      findings,
    };
  },
});
