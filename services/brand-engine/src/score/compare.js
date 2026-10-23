// services/brand-engine/src/score/compare.js
//
// compare <baseline> <candidate>. Pure. It NEVER re-bases: numbers are shown
// as each report recorded them. Across a MAJOR rubric version (dimension set,
// weights or caps) it refuses unless both reports are for the same repository
// and commit, i.e. the same input scored twice; then it says the comparison
// is of methodologies. MINOR differences are annotated, PATCH is wording.
import { EvidenceError, Refused } from './constants.js';
import { validateReportShape } from './schemas.js';
import { say } from './text.js';
import { settle } from './util.js';
import { parseSemver } from '../semver.js';

const key = (e) => `${e.source_class}|${e.check_id ?? e.metric_id ?? e.assessor ?? '-'}`;
const delta = (a, b) => settle(b - a);
const pair = (a, b) => ({ baseline: a, candidate: b, delta: delta(a, b) });
const comparable = (e) => JSON.stringify([e.result, e.value ?? null, e.n ?? null, e.disposition, e.reason_code ?? null]);

function diffEvidence(a, b) {
  const am = new Map(a.map((e) => [key(e), e]));
  const bm = new Map(b.map((e) => [key(e), e]));
  const out = [];
  for (const [k, e] of bm) {
    const before = am.get(k);
    if (!before) out.push({ ref: k, change: 'added', candidate: { result: e.result, disposition: e.disposition, ...(e.value !== undefined ? { value: e.value } : {}) } });
    else if (comparable(before) !== comparable(e)) {
      out.push({
        ref: k, change: 'changed',
        baseline: { result: before.result, disposition: before.disposition, ...(before.value !== undefined ? { value: before.value } : {}) },
        candidate: { result: e.result, disposition: e.disposition, ...(e.value !== undefined ? { value: e.value } : {}) },
      });
    }
  }
  for (const [k, e] of am) {
    if (!bm.has(k)) out.push({ ref: k, change: 'removed', baseline: { result: e.result, disposition: e.disposition, ...(e.value !== undefined ? { value: e.value } : {}) } });
  }
  return out.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));
}

/** Compare two reports. Throws EvidenceError (invalid) or Refused. */
export function compareReports(a, b) {
  const problems = [];
  for (const [name, r] of [['baseline', a], ['candidate', b]]) {
    if (r === null || typeof r !== 'object') problems.push(`${name}: not a JSON object`);
    else problems.push(...validateReportShape(r).map((m) => `${name}: ${m}`));
  }
  if (problems.length) throw new EvidenceError(problems);

  const ra = a.header.rubric;
  const rb = b.header.rubric;
  if (ra.id !== rb.id) throw new Refused(say('compare_refused_rubric_id', { a: ra.id, b: rb.id }));
  if (ra.version === rb.version && ra.sha256 !== rb.sha256) throw new Refused(say('compare_refused_hash', { version: ra.version, a: ra.sha256, b: rb.sha256 }));

  const va = parseSemver(ra.version);
  const vb = parseSemver(rb.version);
  let relationship = 'identical';
  if (va[0] !== vb[0]) relationship = 'major';
  else if (va[1] !== vb[1]) relationship = 'minor';
  else if (va[2] !== vb[2]) relationship = 'patch';

  const sameInput = a.header.input.repo === b.header.input.repo && a.header.input.commit === b.header.input.commit;
  if (relationship === 'major' && !sameInput) {
    throw new Refused(say('compare_refused_major', { a: ra.version, b: rb.version, commit_a: a.header.input.commit, commit_b: b.header.input.commit }));
  }

  const annotations = [];
  const args = { a: ra.version, b: rb.version };
  annotations.push({ code: `rubric_${relationship}`, text: say(`compare_${relationship}`, relationship === 'identical' ? {} : args) });
  if (a.header.profile.sha256 !== b.header.profile.sha256) {
    annotations.push({ code: 'profile_differs', text: say('compare_profile_differs', { a: `${a.header.profile.id}@${a.header.profile.version}`, b: `${b.header.profile.id}@${b.header.profile.version}` }) });
  }
  if (a.header.engine_version !== b.header.engine_version) {
    annotations.push({ code: 'engine_differs', text: say('compare_engine_differs', { a: a.header.engine_version, b: b.header.engine_version }) });
  }
  annotations.push(sameInput
    ? { code: 'same_commit', text: say('compare_commit_same') }
    : { code: 'commit_differs', text: say('compare_commit_differs', { a: a.header.input.commit, b: b.header.input.commit }) });
  annotations.push({ code: 'not_rebased', text: say('compare_not_rebased') });

  const ids = [...b.dimensions.map((d) => d.id), ...a.dimensions.map((d) => d.id).filter((id) => !b.dimensions.some((d) => d.id === id))];
  const dimensions = ids.map((id) => {
    const da = a.dimensions.find((d) => d.id === id);
    const db = b.dimensions.find((d) => d.id === id);
    if (!da || !db) return { id, present_in: da ? 'baseline' : 'candidate', evidence_changes: [] };
    return {
      id, points_earned: pair(da.points_earned, db.points_earned), ceiling_points: pair(da.ceiling_points, db.ceiling_points),
      status: { baseline: da.status, candidate: db.status },
      evidence_changes: diffEvidence(da.evidence, db.evidence),
    };
  });

  const ba = new Set(a.blockers.map((x) => `${x.kind}|${x.finding_id}`));
  const bb = new Set(b.blockers.map((x) => `${x.kind}|${x.finding_id}`));

  return {
    comparison_version: '1.0.0',
    relationship,
    rebased: false,
    annotations,
    baseline: { rubric: `${ra.id}@${ra.version}`, rubric_sha256: ra.sha256, profile: `${a.header.profile.id}@${a.header.profile.version}`, commit: a.header.input.commit, generated_at: a.header.generated_at },
    candidate: { rubric: `${rb.id}@${rb.version}`, rubric_sha256: rb.sha256, profile: `${b.header.profile.id}@${b.header.profile.version}`, commit: b.header.input.commit, generated_at: b.header.generated_at },
    headline: {
      evidenced_score: pair(a.headline.evidenced_score, b.headline.evidenced_score),
      ceiling: pair(a.headline.ceiling, b.headline.ceiling),
      attainment_percent: pair(a.headline.attainment_percent, b.headline.attainment_percent),
    },
    state: { baseline: a.state, candidate: b.state },
    confidence: { baseline: a.confidence.band, candidate: b.confidence.band },
    dimensions,
    blockers: {
      added: [...bb].filter((k) => !ba.has(k)).sort(),
      removed: [...ba].filter((k) => !bb.has(k)).sort(),
    },
  };
}
