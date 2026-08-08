import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt } from '../src/robots.js';

test('parseRobotsTxt disallows a path listed under User-agent: *', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private/\nDisallow: /admin\n');
  assert.equal(rules.isPathAllowed('/private/page'), false);
  assert.equal(rules.isPathAllowed('/admin'), false);
});

test('parseRobotsTxt allows paths not listed', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private/\n');
  assert.equal(rules.isPathAllowed('/public/page'), true);
});

test('parseRobotsTxt with an empty Disallow allows everything', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow:\n');
  assert.equal(rules.isPathAllowed('/anything'), true);
});

test('parseRobotsTxt on empty content allows everything', () => {
  const rules = parseRobotsTxt('');
  assert.equal(rules.isPathAllowed('/anything'), true);
});
