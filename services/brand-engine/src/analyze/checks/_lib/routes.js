// services/brand-engine/src/analyze/checks/_lib/routes.js
//
// A textual reader for Laravel route files (routes/*.php). It never executes PHP. It
// understands Route::get/post/..., match, any, view, redirect, fallback, resource and
// apiResource (with only/except), and nested groups carrying prefix() and name() / as.
// It does not understand routes registered by packages (Fortify, Jetstream, Livewire,
// Folio, Filament, ...), closures that build routes in loops, or route model binding.
// Callers must treat "no match" as "not found in routes/*.php", not as "does not exist".
import { scanBalanced } from './markup.js';
import { lineIndex } from './repo.js';

/** Blank PHP comments, keeping offsets and line breaks. */
export function stripPhpComments(src) {
  let out = '';
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if ((c === '/' && src[i + 1] === '/') || (c === '#' && src[i + 1] !== '[')) {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Top-level argument spans of the call whose `(` is at `open` and `)` at `close - 1`. */
function argSpans(text, open, close) {
  const spans = [];
  let depth = 0;
  let quote = null;
  let from = open + 1;
  for (let j = open + 1; j < close - 1; j += 1) {
    const c = text[j];
    if (quote) { if (c === '\\') j += 1; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { spans.push([from, j]); from = j + 1; }
  }
  if (text.slice(from, close - 1).trim() !== '') spans.push([from, close - 1]);
  return spans;
}

const strLit = (s) => {
  const m = /^\s*(['"])((?:\\.|(?!\1).)*)\1\s*$/.exec(s);
  return m ? m[2].replace(/\\(['"\\])/g, '$1') : null;
};
const strList = (s) => [...s.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);

const joinPath = (...parts) => {
  const p = `/${parts.filter(Boolean).join('/')}`.replace(/\/+/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : p;
};

const RESOURCE = [
  ['index', 'GET', ''], ['create', 'GET', '/create'], ['store', 'POST', ''], ['show', 'GET', '/{}'],
  ['edit', 'GET', '/{}/edit'], ['update', 'PUT', '/{}'], ['destroy', 'DELETE', '/{}'],
];
const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any', 'match', 'view', 'redirect', 'permanentredirect', 'fallback', 'livewire', 'inertia', 'volt']);

/**
 * @returns {{routes: Array<{method:string,path:string,name:string|null,line:number,view:string|null,file:string}>, groups:number}}
 */
export function parseRoutes(source, file) {
  const text = stripPhpComments(source);
  const lineOf = lineIndex(text);
  const routes = [];
  let groups = 0;

  const block = (from, to, state) => {
    let pos = from;
    while (pos < to) {
      const at = text.indexOf('Route::', pos);
      if (at === -1 || at >= to) break;
      let j = at + 7;
      const mm = /^[A-Za-z]+/.exec(text.slice(j, j + 24));
      if (!mm) { pos = j; continue; }
      const chain = [];
      let k = j;
      const readCall = (name, start) => {
        let p = start;
        while (/\s/.test(text[p] ?? '')) p += 1;
        if (text[p] !== '(') return { name, args: [], end: start };
        const end = scanBalanced(text, p);
        if (end === -1) return { name, args: [], end: start, bad: true };
        return { name, args: argSpans(text, p, end), end, open: p };
      };
      let call = readCall(mm[0], j + mm[0].length);
      chain.push(call);
      k = call.end;
      for (;;) {
        let p = k;
        while (/\s/.test(text[p] ?? '')) p += 1;
        if (text[p] === '-' && text[p + 1] === '>') {
          const nm = /^[A-Za-z_]+/.exec(text.slice(p + 2, p + 40));
          if (!nm) break;
          call = readCall(nm[0], p + 2 + nm[0].length);
          chain.push(call);
          if (call.end === p + 2 + nm[0].length && call.bad) break;
          k = call.end;
        } else break;
      }
      pos = Math.max(k, at + 7);

      const argText = (c, i) => (c.args[i] ? text.slice(c.args[i][0], c.args[i][1]) : '');
      const first = chain[0];
      const fname = first.name.toLowerCase();
      const groupCall = chain.find((c) => c.name === 'group');
      const nameCalls = chain.filter((c) => c.name === 'name' || c.name === 'as');
      const prefixCalls = chain.filter((c) => c.name === 'prefix');

      if (groupCall || fname === 'group') {
        groups += 1;
        let prefix = state.prefix;
        let namePrefix = state.namePrefix;
        for (const c of chain) {
          if (c.name === 'prefix') prefix = joinPath(prefix, strLit(argText(c, 0)) ?? '');
          if (c.name === 'name' || c.name === 'as') namePrefix += strLit(argText(c, 0)) ?? '';
        }
        if (fname === 'group') {
          const opts = argText(first, 0);
          const p = /['"]prefix['"]\s*=>\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(opts);
          const a = /['"]as['"]\s*=>\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(opts);
          if (p) prefix = joinPath(prefix, p[2]);
          if (a) namePrefix += a[2];
        }
        const gc = groupCall ?? first;
        const spans = gc.args;
        for (const [s, e] of spans) {
          const body = text.slice(s, e);
          if (/^\s*(?:static\s+)?(?:function|fn)\b/.test(body)) {
            const open = text.indexOf('{', s);
            if (open !== -1 && open < e) {
              const close = scanBalanced(text, open, '{', '}');
              if (close !== -1) block(open + 1, close - 1, { prefix, namePrefix });
              pos = Math.max(pos, close === -1 ? pos : close);
            } else {
              block(s, e, { prefix, namePrefix }); // arrow function
            }
          }
        }
        continue;
      }

      const ownName = nameCalls.length ? strLit(argText(nameCalls[nameCalls.length - 1], 0)) : null;
      const full = (p) => joinPath(state.prefix, p);
      const line = lineOf(at);

      if (fname === 'resources' || fname === 'apiresources') {
        for (const m of argText(first, 0).matchAll(/(['"])([\w./-]+)\1\s*=>/g)) {
          const segs = m[2].split('.');
          let path = '';
          segs.forEach((seg, idx) => { path += `/${seg}${idx < segs.length - 1 ? `/{${singular(seg)}}` : ''}`; });
          const param = singular(segs[segs.length - 1]);
          for (const [action, mth, suffix] of RESOURCE) {
            if (fname === 'apiresources' && (action === 'create' || action === 'edit')) continue;
            routes.push({ method: mth, path: full(path + suffix.replace('{}', `{${param}}`)), name: `${state.namePrefix}${segs.join('.')}.${action}`, line, view: null, file });
          }
        }
        continue;
      }
      if (fname === 'resource' || fname === 'apiresource') {
        const resName = strLit(argText(first, 0));
        if (resName === null) continue;
        const only = chain.find((c) => c.name === 'only');
        const except = chain.find((c) => c.name === 'except');
        const onlySet = only ? new Set(strList(argText(only, 0))) : null;
        const exceptSet = except ? new Set(strList(argText(except, 0))) : new Set();
        const segs = resName.split('.');
        let path = '';
        segs.forEach((seg, idx) => { path += `/${seg}${idx < segs.length - 1 ? `/{${singular(seg)}}` : ''}`; });
        const param = singular(segs[segs.length - 1]);
        for (const [action, method, suffix] of RESOURCE) {
          if (fname === 'apiresource' && (action === 'create' || action === 'edit')) continue;
          if (onlySet && !onlySet.has(action)) continue;
          if (exceptSet.has(action)) continue;
          routes.push({ method, path: full(path + suffix.replace('{}', `{${param}}`)), name: `${state.namePrefix}${segs.join('.')}.${action}`, line, view: null, file });
        }
        continue;
      }
      if (!VERBS.has(fname)) continue;

      let method = ['view', 'redirect', 'permanentredirect', 'livewire', 'inertia', 'volt'].includes(fname) ? 'GET' : fname.toUpperCase();
      let pathArg = 0;
      if (fname === 'match') { method = strList(argText(first, 0)).map((m) => m.toUpperCase()).join('|') || 'GET'; pathArg = 1; }
      if (fname === 'fallback') {
        routes.push({ method: 'GET', path: '*', name: ownName ? `${state.namePrefix}${ownName}` : null, line, view: null, file });
        continue;
      }
      const p = strLit(argText(first, pathArg));
      if (p === null) continue;
      let view = null;
      if (fname === 'view') view = strLit(argText(first, 1));
      else {
        const handler = first.args.slice(pathArg + 1).map(([s, e]) => text.slice(s, e)).join(',');
        const vm = /\bview\(\s*(['"])([\w.\-/]+)\1/.exec(handler);
        if (vm) view = vm[2];
      }
      routes.push({ method, path: full(p), name: ownName ? `${state.namePrefix}${ownName}` : null, line, view, file });
    }
  };

  block(0, text.length, { prefix: '', namePrefix: '' });
  return { routes, groups };
}

// ---- repository-level table ----------------------------------------------------------------------

/** Packages that register their own routes; names we cannot find may belong to them. */
const ROUTE_PACKAGES = ['laravel/fortify', 'laravel/jetstream', 'laravel/ui', 'laravel/breeze', 'laravel/sanctum', 'laravel/folio', 'livewire/livewire', 'livewire/volt', 'filament/filament', 'laravel/nova', 'laravel/telescope', 'laravel/horizon', 'laravel/socialite', 'inertiajs/inertia-laravel', 'laravel/cashier', 'spatie/laravel-permission', 'spatie/laravel-medialibrary'];

export function composerPackages(repo) {
  return repo.memo('composer', () => {
    const src = repo.read('composer.json');
    if (src === null) return new Set();
    try {
      const j = JSON.parse(src);
      return new Set([...Object.keys(j.require ?? {}), ...Object.keys(j['require-dev'] ?? {})]);
    } catch { return new Set(); }
  });
}

/**
 * Pages a package registers on its own. Today: Jetstream's terms and privacy pages (`/terms-of-service`, `/privacy-policy`,
 * route names `terms.show` and `policy.show`), whose text lives in resources/markdown/terms.md and policy.md. They exist
 * when config/jetstream.php enables `Features::termsAndPrivacyPolicy()`; with no config file in the checkout the markdown
 * files are taken as the sign that they are in use. A config that does not enable the feature registers nothing, so a link
 * to those pages is still reported.
 */
export function frameworkPages(repo) {
  return repo.memo('frameworkPages', () => {
    const pages = [];
    if (!composerPackages(repo).has('laravel/jetstream')) return pages;
    const cfg = repo.read('config/jetstream.php');
    const enabled = cfg === null
      ? repo.exists('resources/markdown/terms.md') || repo.exists('resources/markdown/policy.md')
      : /\bFeatures::termsAndPrivacyPolicy\s*\(/.test(stripPhpComments(cfg));
    if (!enabled) return pages;
    pages.push(
      { method: 'GET', path: '/terms-of-service', name: 'terms.show', line: 1, view: null, file: 'config/jetstream.php', provider: 'laravel/jetstream', markdown: 'resources/markdown/terms.md' },
      { method: 'GET', path: '/privacy-policy', name: 'policy.show', line: 1, view: null, file: 'config/jetstream.php', provider: 'laravel/jetstream', markdown: 'resources/markdown/policy.md' },
    );
    return pages;
  });
}

export function routeTable(repo) {
  return repo.memo('routes', () => {
    const files = repo.listAll((rel) => /^routes\/[^/]+\.php$/.test(rel));
    const routes = [];
    let usesAuthRoutes = false;
    for (const f of files) {
      const src = repo.read(f);
      if (src === null) continue;
      routes.push(...parseRoutes(src, f).routes);
      if (/\bAuth::routes\s*\(/.test(src)) usesAuthRoutes = true;
    }
    const pkgs = composerPackages(repo);
    const packageRoutes = ROUTE_PACKAGES.some((p) => pkgs.has(p)) || usesAuthRoutes;
    const provided = frameworkPages(repo);
    routes.push(...provided);
    const names = new Set(routes.map((r) => r.name).filter(Boolean));
    return { files, routes, names, packageRoutes, hasRoutes: files.length > 0, provided: provided.length };
  });
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compile = (path) => {
  let re = '^';
  const segs = path.split('/').filter(Boolean);
  for (const seg of segs) {
    if (/^\{[^}]+\?\}$/.test(seg)) re += '(?:/[^/]+)?';
    else re += `/${seg.split(/\{[^}]+\}/).map(esc).join('[^/]+')}`;
  }
  return new RegExp(`${segs.length ? re : '^'}/?$`);
};

/** Does a concrete (or partly dynamic) URL path match a registered route path? DYN segments match any single segment. */
export function pathMatches(table, urlPath, dyn = '\u0001') {
  const path = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const probe = path.replaceAll(dyn, 'x0x');
  return table.routes.some((r) => {
    if (r.path === '*') return false;
    try { return compile(r.path).test(probe); } catch { return false; }
  });
}
