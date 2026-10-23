// services/brand-engine/src/analyze/checks/_lib/claims.js
//
// Phrase and claim detectors shared by the copy lint (d1) and the claim lint (d6).
// Everything here is a pattern over text a person would read: it can be wrong in both
// directions, which is why a hit carries the matched phrase and a little context and
// never a verdict about the product (see the README for the false-positive limits).
import { CTL, DYN } from './markup.js';
import { lineInUnit } from './sources.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex for a banned phrase: case-insensitive, flexible spaces and hyphens, simple inflections. */
export function phraseRegex(phrase) {
  const words = phrase.trim().split(/[\s‐-―-]+/).filter(Boolean).map(esc);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s\\u2010-\\u2015-]+')}(?:s|es|ed|d|ing|ly)?(?![\\p{L}\\p{N}])`, 'iu');
}

const NEG = /(?:\bno|\bnot|n['’]t|\bnever|\bwithout|\bcannot|\bnor|\bneither)\s+(?:[\w'’-]+\s+){0,2}$/i;
const LIMIT_WORDS = /(?:\bup\s+to|\bper|\bmax(?:imum)?|\blimit(?:ed)?|\bincludes?|\bincluded|\bwith|\bminimum|\bat\s+least|\bfirst|\badd|\binvite|\bextra|\badditional|\bseats?|\bplan|\bunlimited|\bfor|\bof)\s+(?:[\w'’-]+\s+){0,1}$/i;
const COUNT_NOUN = '(?:customers|clients|users|businesses|companies|teams|members|developers|traders|investors|downloads|installs|subscribers|merchants|organi[sz]ations|professionals|brands|people|farmers|miners)';

/**
 * Claim rules. `category` is used to attribute a hit to the profile's claims_policy rules;
 * `severity` is the severity when nothing backs the claim. `skip(before, match)` drops a hit.
 */
export const CLAIM_RULES = [
  { id: 'invented-count', category: 'count', severity: 'blocker', kind: 'unsupported_claim',
    label: 'customer or usage figure',
    patterns: [
      /\btrusted\s+by\s+(?:over\s+|more\s+than\s+|nearly\s+)?\d[\d,.]*(?:\s?[kKmM]\b)?\+?/gi,
      new RegExp(`\\b\\d[\\d,.]*(?:\\s?[kKmM])?\\+?\\s+(?:(?:happy|active|satisfied|paying|global|trusted)\\s+)?${COUNT_NOUN}\\b`, 'gi'),
      new RegExp(`\\b(?:join|used\\s+by|loved\\s+by|serving|helping|powering|chosen\\s+by)\\s+(?:over\\s+|more\\s+than\\s+)?\\d[\\d,.]*(?:\\s?[kKmM]\\b)?\\+?`, 'gi'),
    ],
    skip: (before, m) => LIMIT_WORDS.test(before) && !/^(?:trusted|join|used|loved|serving|helping|powering|chosen)/i.test(m) },
  { id: 'invented-percent', category: 'count', severity: 'major', kind: 'unsupported_claim',
    label: 'percentage or multiple presented as a result',
    patterns: [
      /\b(?:up\s+to\s+|over\s+|more\s+than\s+|save\s+|boost\s+|increase\s+|reduce\s+|cut\s+|improve\s+)?\d{1,3}(?:\.\d+)?\s?%\s+(?:faster|more|less|fewer|cheaper|better|increase|growth|uptime|accuracy|satisfaction|reduction|savings?|improvement|roi|of\s+(?:customers|users|clients|businesses|companies))\b/gi,
      /\buptime\s+(?:of\s+)?\d{2}(?:\.\d+)?\s?%/gi,
      /\b\d+(?:\.\d+)?\s?[x×]\s+(?:faster|more|growth|roi|returns?)\b/gi,
    ] },
  { id: 'invented-rating', category: 'count', severity: 'major', kind: 'unsupported_claim',
    label: 'rating',
    patterns: [/[★⭐]{3,}/g, /\brated\s+\d(?:\.\d)?\s*(?:\/|out\s+of)\s*5\b/gi, /\b\d(?:\.\d)?\s*(?:\/\s?5|out\s+of\s+5)\b/gi] },
  { id: 'compliance-claim', category: 'compliance', severity: 'blocker', kind: 'unsupported_claim',
    label: 'security, compliance or certification claim',
    patterns: [
      /\benterprise[\s-]+(?:ready|grade|class|level)\b/gi,
      /\bbank[\s-]+(?:grade|level|class)\b/gi,
      /\bmilitary[\s-]+(?:grade|level|class)\b/gi,
      /\biso[\s/-]?(?:iec[\s-]?)?(?:9001|14001|27001|27017|27018|27701|22301|45001|13485|20000)\b/gi,
      /\b(?:certified|compliant|accredited|conforms?|conformant|compliance)\s+(?:to|with)?\s*(?:iso|iec)[\s/-]?\d{4,5}\b/gi,
      /\b(?:iso|iec)[\s/-]?\d{4,5}[\s-]+(?:certified|compliant|certification|accredited|compliance)\b/gi,
      /\bsoc\s?[12]\s+(?:type\s+(?:i|ii|1|2)\s+)?(?:certified|compliant|compliance|audited|attested|report|audit)\b/gi,
      /\b(?:fully\s+)?(?:gdpr|popia|hipaa|ccpa|pci[\s-]?dss|fedramp)[\s-]+(?:compliant|certified|ready)\b/gi,
      /\b(?:100\s?%\s+secure|unhackable|hack[\s-]?proof|completely\s+secure|totally\s+secure)\b/gi,
    ] },
  { id: 'guarantee', category: 'returns', severity: 'blocker', kind: 'unsupported_claim',
    label: 'guarantee',
    patterns: [/\bguarantee(?:s|d)?\b/gi, /\brisk[\s-]?free\b/gi, /\bno[\s-]risk\b/gi],
    skip: (before, m) => /^guarantee/i.test(m) && NEG.test(before) },
  { id: 'authorisation-claim', category: 'authorisation', severity: 'blocker', kind: 'unsupported_claim',
    label: 'licensing, authorisation or regulatory claim',
    patterns: [
      /\b(?:authori[sz]ed|licen[sc]ed|regulated|accredited|supervised)\s+(?:and\s+\w+\s+)?(?:by|with|under)\s+(?:the\s+)?/gi,
      /\bwe(?:'re|’re|\s+are)\s+(?:fully\s+|duly\s+)?(?:authori[sz]ed|licen[sc]ed|regulated|registered)\b/gi,
      /\b(?:fully|duly)\s+(?:authori[sz]ed|licen[sc]ed|regulated|registered)\b/gi,
      /\b(?:an?\s+)?(?:authori[sz]ed|licen[sc]ed|regulated)\s+(?:financial|investment|trading|forex|crypto|broker|dealer|bank|lender|credit|insurance|provider|institution|entity|firm|exchange)\b/gi,
      /\bFSP(?:\s*(?:no\.?|number|#)\s*\d*)?\b/g,
      /\bFSCA\b/g,
      /\bregistered\s+(?:financial|credit|investment)\b/gi,
    ],
    // "licensed under the MIT licence" and "approved by the user" are not authority claims: a name must follow.
    skip: (before, m, after) => /(?:by|with|under)\s+(?:the\s+)?$/i.test(m) && (!/^[A-Z]/.test(after) || /^(?:MIT|Apache|GPL|BSD|MPL|CC\b|Creative)/.test(after)) },
  { id: 'returns-claim', category: 'returns', severity: 'blocker', kind: 'unsupported_claim',
    label: 'returns, profit or performance claim',
    patterns: [
      /\b(?:guaranteed|consistent(?:ly)?|high|big|huge|great|massive|strong|steady|proven|attractive|superior|exceptional|double[\s-]digit|risk[\s-]free)\s+(?:returns?|profits?|gains?|yields?)\b/gi,
      /\b(?:guaranteed|passive|steady|consistent|extra|side)\s+income\b/gi,
      /\b(?:earn|make|generate|grow|double|triple)\s+(?:more\s+|extra\s+|your\s+)?(?:money|profits?|returns?|income|wealth)\b/gi,
      /\b(?:returns?|profits?|gains?|roi)\s+(?:of|up\s+to)\s+[$\u20ac\u00a3R]?\s?\d/gi,
      /\bbeat\s+the\s+market\b/gi,
      /\bget\s+rich\b/gi,
      /\bfinancial\s+freedom\b/gi,
    ],
    skip: (before) => NEG.test(before) },
  // A metric label ("Win rate") in a product that computes it is not a claim, but a profile may forbid the wording.
  { id: 'performance-term', category: 'returns', severity: 'major', kind: 'unsupported_claim',
    label: 'performance wording (win rate, track record)',
    patterns: [/\bwin[\s-]?rates?\b/gi, /\btrack\s+record\b/gi],
    skip: (before) => NEG.test(before) },
  { id: 'superlative', category: 'superlative', severity: 'major', kind: 'unsupported_claim',
    label: 'superlative with no evidence',
    patterns: [
      /\b(?:the|ranked|rated|voted|named|is|as|our)\s+#\s?1\b|(?:^|\s)#\s?1\s+(?:in|rated|choice|platform|provider|tool|app|solution|ranked)\b/gi,
      /\b(?:the|ranked|rated|voted|named|is|as|our)\s+no\.?\s?1\b|\bno\.?\s?1\s+(?:in|choice|platform|provider|tool|app|solution|rated|ranked)\b/gi,
      /\bnumber\s+(?:one|1)\b/gi,
      /\bthe\s+best\b/gi,
      /\bbest[\s-]in[\s-]class\b/gi,
      /\bworld['’]s\s+(?:best|leading|first|largest|fastest|safest|most\s+\w+)\b/gi,
      /\b(?:industry|market)[\s-]leading\b/gi,
      /\bmost\s+(?:trusted|popular|secure|reliable|advanced|powerful|accurate)\b/gi,
      /\b(?:unmatched|unrivall?ed|unbeatable|second\s+to\s+none)\b/gi,
      /\bleading\s+provider\b/gi,
    ],
    skip: (before) => NEG.test(before) },
  { id: 'fake-urgency', category: 'urgency', severity: 'major', kind: 'unsupported_claim',
    label: 'urgency or scarcity pattern',
    patterns: [
      /\bonly\s+\d+\s+(?:left|remaining|spots?|seats?|available|in\s+stock)\b/gi,
      /\b\d+\s+(?:people|others|users|customers)\s+(?:are\s+)?(?:viewing|looking|watching|just\s+bought|bought)\b/gi,
      /\b(?:offer|sale|deal|discount|price)s?\s+(?:ends?|expires?|ending|expiring)\s+(?:in|soon|today|tonight|at\s+midnight)\b/gi,
      /\blimited[\s-]time\s+(?:offer|deal|sale|discount|only|price|pricing)\b|\bfor\s+a\s+limited\s+time\s+only\b/gi,
      /\b(?:hurry|act\s+now|last\s+chance|don['’]t\s+miss\s+out|while\s+(?:stocks?|supplies)\s+last)\b/gi,
    ] },
];

/** Words in a policy rule that tie it to a claim category. */
const POLICY_WORDS = {
  count: /customer|user|number|count|figure|usage|numeric|percent|rating|client|testimonial|award/i,
  compliance: /compliance|certif|audit|security|privacy|legal|licen|regist|regulat|authoris|authoriz|approved|endorse/i,
  authorisation: /licen|regist|regulat|authoris|authoriz|approved|endorse|legal.entity|entity/i,
  returns: /return|profit|perform|win rate|track record|yield|income|backtest|result|guarantee/i,
  superlative: /compar|superlat|best|first|number one/i,
  urgency: /urgen|scarcity|pressure/i,
};

/** The profile's forbidden-claim ids that cover a category (attribution only; severity does not depend on it). */
export function policyRulesFor(category, facts) {
  const re = POLICY_WORDS[category];
  if (!re) return [];
  return facts.forbidden.filter((r) => re.test(r.rule) || re.test(r.id)).map((r) => r.id);
}

/** Phrase, up to 40 characters either side, markers removed, one line, never more. */
export function excerpt(text, index, length) {
  const flat = (s) => s.replaceAll(DYN, '…').replaceAll(CTL, ' ').replace(/\s+/g, ' ');
  const before = flat(text.slice(Math.max(0, index - 40), index));
  const hit = flat(text.slice(index, index + length));
  const after = flat(text.slice(index + length, index + length + 40));
  return `${index - 40 > 0 ? '…' : ''}${before}${hit}${after}${index + length + 40 < text.length ? '…' : ''}`.trim();
}

/** All claim-rule hits in one unit, with position. */
export function claimHits(unit) {
  const hits = [];
  const text = unit.text;
  for (const rule of CLAIM_RULES) {
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m[0] === '') { re.lastIndex += 1; continue; }
        const before = text.slice(Math.max(0, m.index - 30), m.index);
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
        if (rule.skip?.(before, m[0], after)) continue;
        hits.push({ rule, index: m.index, length: m[0].length, line: lineInUnit(unit, m.index), phrase: m[0].trim() });
      }
    }
  }
  // overlapping hits of one category are one finding ("trusted by 5,000" and "5,000 businesses"; "guaranteed returns" is both a guarantee and a returns claim)
  const key = (h) => h.rule.category;
  hits.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.index - b.index || b.length - a.length));
  const out = [];
  const lastEnd = new Map();
  for (const h of hits) {
    if (h.index < (lastEnd.get(key(h)) ?? -1)) continue;
    lastEnd.set(key(h), h.index + h.length);
    out.push(h);
  }
  return out.sort((a, b) => a.index - b.index || (a.rule.id < b.rule.id ? -1 : 1));
}
