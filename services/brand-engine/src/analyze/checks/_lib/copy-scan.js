// services/brand-engine/src/analyze/checks/_lib/copy-scan.js
// One pass over the user-facing copy that both d1 and d6 read. Memoised per run.
import { claimHits, phraseRegex } from './claims.js';
import { copyUnits, evidenceExists, lineInUnit, templates } from './sources.js';
import { attrValue, descendants, hasAttr } from './markup.js';

export function claimScan(repo) {
  return repo.memo('claimScan', () => {
    const units = copyUnits(repo);
    const hits = [];
    for (const unit of units) {
      for (const h of claimHits(unit)) {
        const ev = unit.evidence ? { ref: unit.evidence, exists: evidenceExists(repo, unit.evidence) } : null;
        hits.push({ unit, ...h, evidence: ev });
      }
    }
    return { units, hits };
  });
}

export function bannedScan(repo, phrases) {
  const units = copyUnits(repo);
  const res = phrases.map((p) => ({ phrase: p, re: phraseRegex(p) })).filter((x) => x.re);
  const hits = [];
  for (const unit of units) {
    for (const { phrase, re } of res) {
      const m = re.exec(unit.text);
      if (m) hits.push({ unit, phrase, matched: m[0], index: m.index, line: lineInUnit(unit, m.index) });
    }
  }
  return { units, hits };
}

/** Markup-level claim patterns: a testimonial with no source, a countdown timer. */
export function markupClaims(repo) {
  const out = [];
  for (const t of templates(repo)) {
    for (const el of t.elements) {
      if (el.component) continue;
      const cls = `${attrValue(el, 'class') ?? ''} ${attrValue(el, 'id') ?? ''}`.toLowerCase();
      const evidence = (() => {
        for (let p = el; p && p.type === 'el'; p = p.parent) if (hasAttr(p, 'data-evidence')) return attrValue(p, 'data-evidence');
        return t.evidenceMarkers.find((e) => e.line <= el.line && e.line >= el.line - 2)?.ref ?? null;
      })();
      const ev = evidence ? { ref: evidence, exists: evidenceExists(repo, evidence) } : null;
      if (el.tag === 'blockquote' || /\btestimonial/.test(cls)) {
        const inside = [...descendants(el)].filter((n) => n.type === 'el');
        const sourced = hasAttr(el, 'cite') || hasAttr(el, 'data-source') || inside.some((n) => ['cite', 'figcaption', 'footer'].includes(n.tag))
          || (el.parent?.type === 'el' && el.parent.tag === 'figure' && el.parent.children.some((n) => n.type === 'el' && n.tag === 'figcaption'));
        if (!sourced) out.push({ rule: 'testimonial-no-source', file: t.rel, line: el.line, evidence: ev, phrase: el.tag === 'blockquote' ? '<blockquote>' : 'testimonial block', category: 'count' });
      }
      if (/\bcountdown\b/.test(cls) || hasAttr(el, 'data-countdown') || el.tag === 'countdown') {
        out.push({ rule: 'countdown-timer', file: t.rel, line: el.line, evidence: ev, phrase: 'countdown', category: 'urgency' });
      }
    }
  }
  return out;
}

