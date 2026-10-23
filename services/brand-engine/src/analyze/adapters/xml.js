// services/brand-engine/src/analyze/adapters/xml.js
//
// A small, strict XML reader for test reports (JUnit). Not a general XML
// library, and deliberately incapable of the things that make XML dangerous:
// no DOCTYPE, no entity declarations, no external references, no processing
// beyond skipping the XML declaration, no regular expression that can
// backtrack, hard limits on depth and node count. Only the five predefined
// entities and numeric character references are decoded.
//
// parseXml(text, {maxDepth, maxNodes}) -> {name, attrs, children, text}
// `text` is the concatenated character data directly inside the element,
// clipped to 2000 characters. Throws XmlError.
import { REPORT_LIMITS } from '../limits.js';

export class XmlError extends Error {}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;
const MAX_TEXT = 2000;

function decode(raw, at) {
  if (!raw.includes('&')) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf('&', i);
    if (amp === -1) { out += raw.slice(i); break; }
    out += raw.slice(i, amp);
    const semi = raw.indexOf(';', amp);
    if (semi === -1 || semi - amp > 10) throw new XmlError(`bad entity near offset ${at + amp}`);
    const body = raw.slice(amp + 1, semi);
    if (body === 'lt') out += '<';
    else if (body === 'gt') out += '>';
    else if (body === 'amp') out += '&';
    else if (body === 'quot') out += '"';
    else if (body === 'apos') out += "'";
    else if (/^#[0-9]{1,7}$/.test(body) || /^#x[0-9a-fA-F]{1,6}$/.test(body)) {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) throw new XmlError(`bad character reference near offset ${at + amp}`);
      out += String.fromCodePoint(code);
    } else throw new XmlError(`unsupported entity &${body.slice(0, 12)}; (entities cannot be declared)`);
    i = semi + 1;
  }
  return out;
}

export function parseXml(input, { maxDepth = REPORT_LIMITS.maxXmlDepth, maxNodes = REPORT_LIMITS.maxXmlNodes } = {}) {
  let s = input;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const len = s.length;
  let i = 0;
  let nodes = 0;
  const stack = [];
  let root = null;

  const skipWs = () => { while (i < len && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i += 1; };
  const readName = () => {
    if (i >= len || !NAME_START.test(s[i])) throw new XmlError(`expected a name at offset ${i}`);
    const start = i;
    i += 1;
    while (i < len && NAME_CHAR.test(s[i])) i += 1;
    if (i - start > 100) throw new XmlError('name too long');
    return s.slice(start, i);
  };
  const addText = (t) => {
    const top = stack[stack.length - 1];
    if (top && top.text.length < MAX_TEXT) top.text = (top.text + t).slice(0, MAX_TEXT);
  };

  while (i < len) {
    if (s[i] !== '<') {
      const next = s.indexOf('<', i);
      const end = next === -1 ? len : next;
      const chunk = s.slice(i, end);
      if (stack.length === 0) { if (chunk.trim() !== '') throw new XmlError(`text outside the root element at offset ${i}`); } else addText(decode(chunk, i));
      i = end;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) throw new XmlError('unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) throw new XmlError('unterminated comment');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) throw new XmlError('unterminated CDATA section');
      if (stack.length === 0) throw new XmlError('CDATA outside the root element');
      addText(s.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (s.startsWith('<!', i)) throw new XmlError('DOCTYPE and entity declarations are not allowed');
    if (s.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipWs();
      if (s[i] !== '>') throw new XmlError(`malformed closing tag at offset ${i}`);
      i += 1;
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlError(`closing tag </${name}> does not match`);
      continue;
    }
    // opening tag
    i += 1;
    const name = readName();
    const attrs = Object.create(null);
    let selfClose = false;
    for (;;) {
      skipWs();
      if (i >= len) throw new XmlError('unterminated tag');
      if (s[i] === '>') { i += 1; break; }
      if (s[i] === '/' && s[i + 1] === '>') { selfClose = true; i += 2; break; }
      const an = readName();
      skipWs();
      if (s[i] !== '=') throw new XmlError(`attribute ${an} has no value`);
      i += 1;
      skipWs();
      const q = s[i];
      if (q !== '"' && q !== "'") throw new XmlError(`attribute ${an} is not quoted`);
      const close = s.indexOf(q, i + 1);
      if (close === -1) throw new XmlError('unterminated attribute value');
      const rawValue = s.slice(i + 1, close);
      if (rawValue.includes('<')) throw new XmlError(`attribute ${an} contains "<"`);
      if (Object.hasOwn(attrs, an)) throw new XmlError(`duplicate attribute ${an}`);
      attrs[an] = decode(rawValue, i).slice(0, 4000);
      i = close + 1;
    }
    nodes += 1;
    if (nodes > maxNodes) throw new XmlError(`more than ${maxNodes} elements`);
    const node = { name, attrs, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root) throw new XmlError('more than one root element');
    else root = node;
    if (!selfClose) {
      stack.push(node);
      if (stack.length > maxDepth) throw new XmlError(`nesting deeper than ${maxDepth}`);
    }
  }
  if (stack.length) throw new XmlError(`unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError('no root element');
  return root;
}
