// Contrast maths against published reference values, and the colour parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compositeOver, contrastRatio, meetsContrast, parseColor, relativeLuminance, toHex } from '../../src/analyze/checks/_lib/color.js';

const ratio = (a, b) => contrastRatio(parseColor(a), parseColor(b));

test('relative luminance of black and white', () => {
  assert.equal(relativeLuminance(parseColor('#000')), 0);
  assert.equal(relativeLuminance(parseColor('#fff')), 1);
});

test('contrast ratios match published WCAG reference values', () => {
  const refs = [
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#ffffff', 1],
    ['#767676', '#ffffff', 4.54], // the lightest grey that passes AA on white
    ['#777777', '#ffffff', 4.48], // one step lighter fails
    ['#595959', '#ffffff', 7.0],
    ['#808080', '#ffffff', 3.95],
    ['#ff0000', '#ffffff', 4.0],
    ['#0000ff', '#ffffff', 8.59],
    ['#ff0000', '#000000', 5.25],
    ['#949494', '#ffffff', 3.03],
    ['#959595', '#ffffff', 3.0],
  ];
  for (const [a, b, want] of refs) {
    assert.ok(Math.abs(ratio(a, b) - want) < 0.006, `${a} on ${b}: got ${ratio(a, b)}, want about ${want}`);
    assert.equal(ratio(a, b), ratio(b, a), 'symmetric');
  }
});

test('the thresholds are compared on the unrounded ratio: 4.5 passes, 4.4999 does not', () => {
  assert.equal(meetsContrast(4.5, 4.5), true);
  assert.equal(meetsContrast(4.4999, 4.5), false);
  assert.equal(meetsContrast(3, 3), true);
  assert.equal(meetsContrast(2.9999, 3), false);
  // real colours on either side of each threshold
  assert.equal(meetsContrast(ratio('#767676', '#fff'), 4.5), true);
  assert.equal(meetsContrast(ratio('#777777', '#fff'), 4.5), false);
  assert.equal(meetsContrast(ratio('#949494', '#fff'), 3), true);
  assert.equal(meetsContrast(ratio('#959595', '#fff'), 3), false, '2.99 is not 3');
});

test('parseColor reads hex, rgb, hsl, oklch and named colours', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('#aabbcc80'), { r: 170, g: 187, b: 204, a: 128 / 255 });
  assert.equal(toHex(parseColor('rgb(29, 79, 145)')), '#1d4f91');
  assert.equal(toHex(parseColor('rgb(29 79 145 / 50%)')), '#1d4f91');
  assert.equal(parseColor('rgba(0,0,0,0.25)').a, 0.25);
  assert.equal(toHex(parseColor('hsl(0, 100%, 50%)')), '#ff0000');
  assert.equal(toHex(parseColor('hsl(120deg 100% 25%)')), '#008000');
  assert.equal(toHex(parseColor('oklch(1 0 0)')), '#ffffff');
  assert.equal(toHex(parseColor('oklch(0 0 0)')), '#000000');
  assert.equal(toHex(parseColor('WHITE')), '#ffffff');
  assert.equal(parseColor('transparent').a, 0);
});

test('anything that cannot be read is null, never a guess', () => {
  for (const v of ['var(--x)', 'currentColor', 'color-mix(in srgb, red, blue)', 'lab(50% 40 59)', 'linear-gradient(red, blue)', '', 'not-a-colour', '#12', 'rgb(1,2)', 'rgb(a,b,c)', null, undefined, 3]) {
    assert.equal(parseColor(v), null, String(v));
  }
});

test('translucent colours are composited over the backdrop in sRGB', () => {
  const c = compositeOver(parseColor('rgba(0,0,0,0.5)'), parseColor('#ffffff'));
  assert.equal(toHex(c), '#808080');
  assert.equal(c.a, 1);
});
