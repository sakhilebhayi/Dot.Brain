// d6.honest_states: static analysis can see whether a list screen has wording for an empty, error or
// unavailable state. It cannot see whether that wording is true, or whether the data shown is real, so this
// check never yields a share: it reports its observations as info findings and stays not_measured.
import { defineCheck } from './_lib/define.js';
import { copyUnits, templates } from './_lib/sources.js';
import { isScreenTemplate } from './_lib/repo.js';

const ID = 'd6.honest_states';
const LOOP = /@foreach\b|@forelse\b|v-for\s*=|\{#each\b|x-for\s*=|<table\b|<tbody\b|\.map\s*\(/;
const EMPTY_DIRECTIVE = /@empty\b|@forelse\b|v-else|\{:else\}|\.length\s*===?\s*0|isEmpty\(\)|\$\w+->isEmpty|\bcount\(\s*\$\w+\s*\)\s*(?:===?|==)\s*0/;
const EMPTY_TEXT = /\b(?:no\s+(?:\w+\s+){0,3}(?:yet|found|available|results?|records?|items?|data|entries|matches)|nothing\s+(?:here|to\s+show|found|yet)|nothing\s+to\s+display|is\s+empty|haven['’]t\s+\w+\s+(?:any|yet)|no\s+\w+\s+to\s+(?:show|display))\b/i;
const ERROR_TEXT = /\b(?:something\s+went\s+wrong|couldn['’]t|could\s+not|failed\s+to|unable\s+to|error\s+loading|try\s+again|not\s+available|unavailable)\b/i;

export default defineCheck({
  id: ID,
  title: 'Empty, error and unavailable state wording on list screens (presence only)',
  noUiReason: 'no templates found',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const units = copyUnits(repo);
    const findings = [];
    let lists = 0;
    for (const t of templates(repo)) {
      if (!isScreenTemplate(t.rel)) continue;
      if (!LOOP.test(t.source)) continue;
      lists += 1;
      const text = units.filter((u) => u.file === t.rel).map((u) => u.text).join('\n');
      const empty = EMPTY_DIRECTIVE.test(t.source) || EMPTY_TEXT.test(text);
      const err = ERROR_TEXT.test(text);
      findings.push({
        rule: empty ? 'list-empty-state-present' : 'list-empty-state-absent',
        severity: 'info',
        message: empty
          ? `List screen: wording or a branch for an empty list is present${err ? ' and error/unavailable wording is present' : ''}. Whether it is true is not assessed.`
          : `List screen: no wording or branch for an empty list was found${err ? '' : ', and no error/unavailable wording'}.`,
        file: t.rel, line: 1,
        hint: empty ? 'Check by hand that the wording says what is true and shows no invented data.' : 'Say plainly what an empty, failed or unavailable list means and what to do next.',
      });
    }
    return {
      notMeasured: lists === 0
        ? 'no list screens (loops or tables) were found in the templates'
        : `${lists} list screen(s) were inspected for empty/error wording; whether states are honest and show no invented data needs a person or a rendered page, so no share is produced`,
      findings,
    };
  },
});
