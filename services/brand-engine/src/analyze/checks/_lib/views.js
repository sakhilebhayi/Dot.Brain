// services/brand-engine/src/analyze/checks/_lib/views.js
//
// "Is this Blade template mounted?" A template nobody renders cannot be reached by a visitor, so a markup
// defect in it must not be reported as a WCAG blocker (Phase 1 finding F4: an unmounted Livewire view with an
// <img> and no alt blocked a whole product). This module answers the question by reachability, textually, never
// by running PHP:
//
//   roots      PHP that is not a component class (routes, controllers, mailables, providers, config, ...): every
//              string literal that equals a view name mounts that view; every `Foo::class` mounts the component
//              class called Foo; every literal that equals a Livewire component name mounts it
//   edges      from a mounted template: @include / @extends / @each / @component, <x-name>, <livewire:name>,
//              @livewire('name'); from a mounted component class: the views and components its code names
//   conventions views a framework package resolves by name (errors.*, vendor.*, and with Jetstream, Breeze, Fortify,
//              Livewire or Folio installed their own conventional names); never reported as unmounted
//
// The answer is deliberately conservative: when it cannot tell, a template is MOUNTED. A view chosen at run time
// (view($variable)) turns the whole answer off, or, when the literal prefix is visible, everything under that prefix. A
// component chosen at run time (@livewire($name), <livewire:is>, <x-dynamic-component>) can only name a component that is
// spelled somewhere, so every string literal in the code that equals a component name mounts it. What is not seen is a name that
// exists only in data (a database row, a JSON file). So "unmounted" is only ever said about a template that nothing in the
// checkout names.
import { composerPackages, stripPhpComments } from './routes.js';
import { allTemplates } from './sources.js';

const VIEW_DIR = 'resources/views/';
const COMPONENT_DIRS = [
  { dir: 'app/Livewire/', kind: 'livewire' },
  { dir: 'app/Http/Livewire/', kind: 'livewire' },
  { dir: 'app/View/Components/', kind: 'blade' },
];
const NOT_ROOT = /(?:^|\/)(?:tests?|Tests?|stubs?)\//;
const FRAMEWORK_PACKAGES = ['laravel/jetstream', 'laravel/breeze', 'laravel/fortify', 'laravel/ui', 'livewire/livewire', 'livewire/volt', 'laravel/folio'];
const CONVENTION_PREFIXES = ['errors.', 'vendor.'];
const PACKAGE_PREFIXES = ['auth.', 'profile.', 'api.', 'teams.', 'layouts.', 'components.layouts.', 'livewire.layout.'];
const PACKAGE_NAMES = new Set(['terms', 'policy', 'dashboard', 'navigation-menu', 'emails.team-invitation']);

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
const dotted = (rel) => rel.split('/').map(kebab).join('.');

/** resources/views/a/b.blade.php -> a.b, or null when the path is not a view. */
export function viewName(rel) {
  const m = /^resources\/views\/(.+)\.blade\.php$/.exec(rel);
  return m ? m[1].replaceAll('/', '.') : null;
}

const stripBladeComments = (s) => s.replace(/\{\{--[\s\S]*?--\}\}/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const LITERAL = /(['"])([A-Za-z0-9_.\-]+)\1/g;
const CLASS_REF = /\b([A-Z][A-Za-z0-9_]*)::class\b/g;
// The view helper and the facade; not a method that happens to be called view() (`public function view($id)`, `$x->view($id)`).
const VIEW_CALL = /(?<!(?:function|->|::)\s*)(?:\bview|\bView::make)\(\s*/g;

export function viewReach(repo) {
  return repo.memo('viewReach', () => build(repo));
}

function build(repo) {
  const unknown = { known: false, unmountedWhy: () => null };
  if (!repo.hasDir('resources/views')) return unknown;

  const views = new Map(); // view name -> template
  for (const t of allTemplates(repo)) {
    const name = t.kind === 'blade' ? viewName(t.rel) : null;
    if (name) views.set(name, t);
  }
  if (views.size === 0) return unknown;

  // component classes (nodes) and the PHP that is not one (roots)
  const classes = [];
  const rootFiles = [];
  for (const rel of repo.listAll((r) => r.endsWith('.php') && !r.endsWith('.blade.php') && !NOT_ROOT.test(r))) {
    const comp = COMPONENT_DIRS.find((c) => rel.startsWith(c.dir));
    if (comp) {
      const rest = rel.slice(comp.dir.length).replace(/\.php$/, '');
      classes.push({ rel, kind: comp.kind, name: dotted(rest), base: rest.split('/').pop(), text: null, mounted: false });
    } else rootFiles.push(rel);
  }
  if (rootFiles.length === 0) return unknown; // views but no PHP to render them: nothing can be said about reachability
  const classesByBase = new Map();
  for (const c of classes) classesByBase.set(c.base, [...(classesByBase.get(c.base) ?? []), c]);

  const pkgs = composerPackages(repo);
  const hasFramework = FRAMEWORK_PACKAGES.some((p) => pkgs.has(p));

  // Livewire component names: from classes, and from view files under livewire/ (class-less and Volt components)
  const livewireNames = new Set(classes.filter((c) => c.kind === 'livewire').map((c) => c.name));
  for (const name of views.keys()) if (name.startsWith('livewire.')) livewireNames.add(name.slice('livewire.'.length));

  const mountedViews = new Set();
  const mountedLivewire = new Set();
  const mountedX = new Set();
  const prefixes = [];
  let everything = false;
  let dynLivewire = false; // a Livewire component is chosen at run time: any literal that names one mounts it
  let dynX = false;
  const texts = []; // every PHP text and mounted template scanned, so a late-discovered dynamic mount can look back
  const queue = [];

  const mountView = (name) => {
    if (!views.has(name) || mountedViews.has(name)) return;
    mountedViews.add(name);
    queue.push(views.get(name));
  };
  const mountClass = (c) => {
    if (c.mounted) return;
    c.mounted = true;
    c.text = stripPhpComments(repo.read(c.rel) ?? '');
    scanPhp(c.text);
  };
  const mountLivewire = (name) => {
    if (mountedLivewire.has(name)) return;
    mountedLivewire.add(name);
    mountView(`livewire.${name}`);
    for (const c of classes) if (c.kind === 'livewire' && c.name === name) mountClass(c);
  };
  const mountX = (name) => {
    if (mountedX.has(name)) return;
    mountedX.add(name);
    for (const v of [`components.${name}`, `components.${name}.index`, `components.${name}.${name.split('.').pop()}`]) mountView(v);
    for (const c of classes) if (c.kind === 'blade' && c.name === name) mountClass(c);
  };

  function scanPhp(text) {
    texts.push(text);
    for (const m of text.matchAll(LITERAL)) {
      const v = m[2];
      if (views.has(v)) mountView(v);
      if (livewireNames.has(v)) mountLivewire(v);
    }
    for (const m of text.matchAll(CLASS_REF)) for (const c of classesByBase.get(m[1]) ?? []) {
      if (c.kind === 'livewire') mountLivewire(c.name);
      else mountX(c.name);
    }
    for (const m of text.matchAll(VIEW_CALL)) {
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
      if (/^\)/.test(rest)) continue; // view(): the factory, no name
      const concat = /^(['"])([A-Za-z0-9_.\-]*)\1\s*\./.exec(rest);
      const interp = /^"([A-Za-z0-9_.\-]*)(?:\$|\{)/.exec(rest);
      if (concat) prefixes.push(concat[2]);
      else if (interp) prefixes.push(interp[1]);
      else if (!/^(['"])/.test(rest)) everything = true; // view($name), view(config(...)): the set of rendered views is unknowable
    }
  }

  function scanTemplate(t) {
    const src = stripBladeComments(t.source);
    texts.push(src);
    for (const m of src.matchAll(/@(?:include|includeIf|extends|each|component|includeWhen|includeUnless)\s*\(\s*(?:[^,'"()]+,\s*)?(['"])([A-Za-z0-9_.\-]+)\1/g)) mountView(m[2]);
    for (const m of src.matchAll(/@includeFirst\s*\(\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(LITERAL)) mountView(n[2]);
    for (const m of src.matchAll(/<x-([A-Za-z0-9_.\-]+)/g)) {
      if (m[1] === 'dynamic-component') dynX = true;
      else mountX(m[1]);
    }
    for (const m of src.matchAll(/<livewire:([A-Za-z0-9_.\-]+)/g)) {
      if (m[1] === 'is' || m[1] === 'dynamic-component') dynLivewire = true;
      else mountLivewire(m[1]);
    }
    for (const m of src.matchAll(/@livewire\s*\(\s*(['"])([A-Za-z0-9_.\-]+)\1/g)) mountLivewire(m[2]);
    for (const m of src.matchAll(/@livewire\s*\(\s*(?!['"])([^)]*)\)/g)) {
      const cls = /^\\?(?:[A-Za-z0-9_\\]*\\)?([A-Z][A-Za-z0-9_]*)::class/.exec(m[1].trim());
      if (cls) for (const c of classesByBase.get(cls[1]) ?? []) mountLivewire(c.name);
      else dynLivewire = true;
    }
    for (const m of src.matchAll(/\bview\(\s*(['"])([A-Za-z0-9_.\-]+)\1/g)) mountView(m[2]);
  }

  // roots
  for (const rel of rootFiles) {
    const text = repo.read(rel);
    if (text !== null) scanPhp(stripPhpComments(text));
  }
  const conventionPrefixes = [...CONVENTION_PREFIXES, ...(hasFramework ? PACKAGE_PREFIXES : []), ...(pkgs.has('laravel/folio') ? ['pages.'] : [])];
  const byConvention = (name) => conventionPrefixes.some((p) => name.startsWith(p)) || (hasFramework && PACKAGE_NAMES.has(name));

  // fixpoint. texts only grows, so each dynamic scan resumes where it stopped.
  const xNames = new Set(classes.filter((c) => c.kind === 'blade').map((c) => c.name));
  for (const v of views.keys()) if (v.startsWith('components.')) xNames.add(v.slice('components.'.length));
  let lwScanned = 0;
  let xScanned = 0;
  for (;;) {
    while (queue.length) scanTemplate(queue.shift());
    if (dynLivewire) {
      for (; lwScanned < texts.length; lwScanned += 1) for (const m of texts[lwScanned].matchAll(LITERAL)) if (livewireNames.has(m[2])) mountLivewire(m[2]);
    }
    if (dynX) {
      for (; xScanned < texts.length; xScanned += 1) for (const m of texts[xScanned].matchAll(LITERAL)) if (xNames.has(m[2])) mountX(m[2]);
    }
    if (queue.length === 0 && (!dynLivewire || lwScanned >= texts.length) && (!dynX || xScanned >= texts.length)) break;
  }

  const covered = (name) => everything || mountedViews.has(name) || byConvention(name) || prefixes.some((p) => p !== '' && name.startsWith(p)) || prefixes.includes('');

  return {
    known: true,
    stats: { views: views.size, mounted: [...views.keys()].filter(covered).length },
    /** A short reason when the template is provably not mounted, otherwise null (mounted, or impossible to tell). */
    unmountedWhy(rel) {
      const name = viewName(rel);
      if (name === null || !views.has(name) || covered(name)) return null;
      return 'Downgraded to major: this template is not mounted by any route, view() call, include, component or Livewire tag in the checkout (a name that exists only in data is not seen), so no visitor reaches it.';
    },
  };
}
