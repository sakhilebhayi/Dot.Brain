// d8.labels_alt_lang: the share of form fields with a label, images with alternative text and
// documents with a language attribute. Also reports, without changing the share: a missing or empty
// <title>, buttons and links with no accessible name, iframes with no title, a missing viewport meta,
// zoom disabled, and ARIA/keyboard misuse that is visible in markup. Dynamic fragments and components are
// opaque: an element carrying one is skipped, never reported.
import { defineCheck } from './_lib/define.js';
import { templates } from './_lib/sources.js';
import { DYN, closest, descendants, textOf } from './_lib/markup.js';

const ID = 'd8.labels_alt_lang';
const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const NON_INTERACTIVE = new Set(['div', 'span', 'li', 'p', 'td', 'tr', 'img', 'i', 'b', 'svg', 'section', 'article', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const WIDGET_ROLES = new Set(['button', 'link', 'checkbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'textbox', 'combobox', 'slider', 'spinbutton', 'treeitem']);
const ROLES = new Set(['alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem', 'doc-abstract', 'doc-pagelist', 'doc-toc', 'doc-chapter', 'doc-footnote', 'doc-credit']);
const CLICK_ATTRS = ['onclick', '@click', 'v-on:click', 'x-on:click', 'wire:click', 'ng-click', '(click)'];

// Reusable components (Vue/React/Blade) are fragments: the consumer supplies the label and the slot content.
const isFragmentFile = (t) => /(?:^|\/)components?\//i.test(t.rel) || (['vue', 'jsx', 'svelte'].includes(t.kind) && /^[A-Z]/.test(t.rel.split('/').pop()));
const hasText = (el) => [...descendants(el)].some((n) => n.type === 'text' && n.text.replace(/[\s\u0002]/g, '') !== '');
const hasOpaqueChild = (el) => [...descendants(el)].some((n) => n.type === 'el' && (n.component || n.tag === 'slot' || ['button', 'a', 'input', 'select', 'textarea'].includes(n.tag)));

const val = (el, n) => el.attrs.get(n)?.value ?? null;
const present = (el, n) => el.attrs.has(n);
const nonEmpty = (el, n) => { const a = el.attrs.get(n); return Boolean(a) && (a.dynamic || a.value.replaceAll(DYN, 'x').trim() !== ''); };
const hidden = (el) => val(el, 'aria-hidden') === 'true' || present(el, 'hidden');

function hasName(el) {
  if (nonEmpty(el, 'aria-label') || nonEmpty(el, 'aria-labelledby') || nonEmpty(el, 'title')) return true;
  if (el.tag === 'input' && nonEmpty(el, 'value')) return true;
  for (const n of descendants(el)) {
    if (n.type === 'text') { if (n.text.replace(/[\s\u0002]/g, '') !== '') return true; continue; }
    if (hidden(n)) continue;
    if (n.component || n.dynamicAttrs || n.tag === 'slot') return true; // opaque: may render a name
    if (n.tag === 'img' && nonEmpty(n, 'alt')) return true;
    if (n.tag === 'svg' && (nonEmpty(n, 'aria-label') || [...descendants(n)].some((c) => c.type === 'el' && c.tag === 'title'))) return true;
    if (nonEmpty(n, 'aria-label') || nonEmpty(n, 'title')) return true;
  }
  return false;
}

export default defineCheck({
  id: ID,
  title: 'Labels, alternative text and language (static)',
  noUiReason: 'no templates found: nothing to inspect',
  applies: (repo) => templates(repo).length > 0,
  measure(repo) {
    const findings = [];
    let controls = 0; let controlsOk = 0;
    let images = 0; let imagesOk = 0;
    let docs = 0; let docsOk = 0;
    const skippedOpaque = { dynamic: 0 };

    for (const t of templates(repo)) {
      const labelFor = new Set();
      for (const el of t.elements) {
        if ((el.tag === 'label' || (el.component && /label/i.test(el.rawTag))) && present(el, 'for')) labelFor.add(val(el, 'for'));
      }
      const add = (rule, severity, el, message, hint, extra = {}) => findings.push({ rule, severity, message, file: t.rel, line: el.line, hint, ...extra });

      if (t.isDocument) {
        const html = t.elements.find((e) => e.tag === 'html');
        docs += 1;
        if (html && !html.dynamicAttrs && !(present(html, 'lang') || present(html, 'xml:lang'))) {
          add('html-lang-missing', 'blocker', html, 'The <html> element has no lang attribute, so assistive technology cannot choose a pronunciation (WCAG 3.1.1).', 'Add lang="en" (or the page language) to <html>.', { kind: 'wcag_failure', level: 'A', criterion: '3.1.1' });
        } else if (html && present(html, 'lang') && !nonEmpty(html, 'lang')) {
          add('html-lang-missing', 'blocker', html, 'The <html> lang attribute is empty (WCAG 3.1.1).', 'Set lang to the page language, for example lang="en".', { kind: 'wcag_failure', level: 'A', criterion: '3.1.1' });
        } else docsOk += 1;

        const title = t.elements.find((e) => e.tag === 'title');
        const headManaged = /@inertiaHead|<Head\b|<x-head|<x-layout|<x-app-layout|<x-guest-layout|<x-seo|<livewire:|@livewire/.test(t.source);
        if (!title && !headManaged) {
          add('title-missing', 'major', html ?? t.elements[0], 'The document has no <title>, and nothing in the file suggests the title is set elsewhere (WCAG 2.4.2).', 'Add a <title> that names the page; if a layout or component sets it, this finding is a false positive.', { level: 'A', criterion: '2.4.2' });
        } else if (title && !title.dynamicAttrs && textOf(title).replace(/[\s\u0002]/g, '') === '') {
          add('title-empty', 'blocker', title, 'The <title> element is empty (WCAG 2.4.2).', 'Give the page a descriptive title.', { kind: 'wcag_failure', level: 'A', criterion: '2.4.2' });
        }
        const vp = t.elements.find((e) => e.tag === 'meta' && (val(e, 'name') ?? '').toLowerCase() === 'viewport');
        if (!vp && !headManaged) {
          add('viewport-missing', 'minor', html ?? t.elements[0], 'No viewport meta tag: the page will not scale to small screens.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
        } else if (vp) {
          const c = (val(vp, 'content') ?? '').toLowerCase();
          const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(c);
          if (/user-scalable\s*=\s*(?:no|0)/.test(c) || (maxScale && parseFloat(maxScale[1]) <= 1)) {
            add('viewport-zoom-disabled', 'blocker', vp, 'The viewport meta tag disables pinch zoom (user-scalable=no or maximum-scale=1), which blocks text resizing (WCAG 1.4.4).', 'Remove user-scalable=no and maximum-scale from the viewport content.', { kind: 'wcag_failure', level: 'AA', criterion: '1.4.4' });
          }
        }
      }

      for (const el of t.elements) {
        if (el.component) continue;
        if (el.dynamicAttrs) { skippedOpaque.dynamic += 1; continue; }
        const role = (val(el, 'role') ?? '').toLowerCase();

        if (el.tag === 'img') {
          images += 1;
          if (present(el, 'alt') || role === 'presentation' || role === 'none' || val(el, 'aria-hidden') === 'true') {
            imagesOk += 1;
            const alt = val(el, 'alt');
            if (alt && !el.attrs.get('alt').dynamic && (/\.(?:png|jpe?g|gif|svg|webp|avif)$/i.test(alt.trim()) || /^(?:image|img|photo|picture|graphic|icon)$/i.test(alt.trim()))) {
              add('img-alt-filename', 'minor', el, `The image alt text "${alt.trim().slice(0, 40)}" is a file name or a generic word, not a description.`, 'Describe what the image conveys, or use alt="" if it is decorative.', { level: 'A', criterion: '1.1.1' });
            }
          } else {
            add('img-alt-missing', 'blocker', el, 'An <img> has no alt attribute (WCAG 1.1.1). Use alt="" for a decorative image.', 'Add alt text that conveys the image, or alt="" if it is decorative.', { kind: 'wcag_failure', level: 'A', criterion: '1.1.1' });
          }
        } else if (el.tag === 'svg' && role === 'img' && !nonEmpty(el, 'aria-label') && !nonEmpty(el, 'aria-labelledby') && ![...descendants(el)].some((c) => c.type === 'el' && c.tag === 'title')) {
          add('svg-img-no-name', 'major', el, 'An <svg role="img"> has no accessible name (no aria-label, aria-labelledby or <title>).', 'Add aria-label or a <title> child, or mark it decorative with aria-hidden="true".', { level: 'A', criterion: '1.1.1' });
        } else if (el.tag === 'input' && (val(el, 'type') ?? '').toLowerCase() === 'image' && !nonEmpty(el, 'alt')) {
          add('input-image-alt', 'blocker', el, 'An <input type="image"> has no alt text (WCAG 1.1.1).', 'Add an alt attribute naming the action.', { kind: 'wcag_failure', level: 'A', criterion: '1.1.1' });
        }

        if ((el.tag === 'input' && !SKIP_INPUT_TYPES.has((val(el, 'type') ?? 'text').toLowerCase())) || el.tag === 'select' || el.tag === 'textarea') {
          if (!hidden(el) && !isFragmentFile(t)) {
            controls += 1;
            const id = val(el, 'id');
            const labelled = nonEmpty(el, 'aria-label') || nonEmpty(el, 'aria-labelledby') || nonEmpty(el, 'title')
              || closest(el, (a) => a.tag === 'label') !== null
              || (id !== null && (labelFor.has(id) || id.includes(DYN)));
            if (labelled) controlsOk += 1;
            else {
              add('control-no-label', 'major', el, `A <${el.tag}> has no associated label: no <label for>, no enclosing <label>, no aria-label or aria-labelledby${present(el, 'placeholder') ? ' (a placeholder is not a label)' : ''} (WCAG 1.3.1, 3.3.2, 4.1.2).`, 'Add a visible <label for="id"> (preferred) or an aria-label. If the label lives in another file, this finding is a false positive.', { level: 'A', criterion: '3.3.2' });
            }
          }
        }

        const isLink = el.tag === 'a' && present(el, 'href');
        if ((el.tag === 'button' || isLink || role === 'button' || role === 'link') && !hidden(el)) {
          if (!hasName(el)) {
            add('name-missing', 'major', el, `A ${el.tag === 'a' ? 'link' : 'button'} has no accessible name: no text, aria-label, title, or labelled image or icon inside (WCAG 4.1.2, 2.4.4).`, 'Add visible text, or aria-label for an icon-only control.', { level: 'A', criterion: '4.1.2' });
          }
        }
        if (el.tag === 'iframe' && !nonEmpty(el, 'title') && !nonEmpty(el, 'aria-label')) {
          add('iframe-title', 'major', el, 'An <iframe> has no title (WCAG 4.1.2, 2.4.1).', 'Add a title attribute that says what the frame contains.', { level: 'A', criterion: '4.1.2' });
        }

        if (role && !ROLES.has(role.split(/\s+/)[0])) {
          add('aria-invalid-role', 'minor', el, `The role "${role.slice(0, 30)}" is not a WAI-ARIA role.`, 'Use a valid role or remove it.');
        }
        const focusable = present(el, 'tabindex') || ['a:href', 'button', 'input', 'select', 'textarea', 'summary'].some((s) => (s === 'a:href' ? isLink : el.tag === s));
        if (WIDGET_ROLES.has(role) && NON_INTERACTIVE.has(el.tag) && !present(el, 'tabindex')) {
          add('aria-role-not-focusable', 'major', el, `<${el.tag} role="${role}"> cannot be reached with the keyboard: it has no tabindex (WCAG 2.1.1).`, 'Use a native <button> or <a href>, or add tabindex="0" and key handlers.', { level: 'A', criterion: '2.1.1' });
        }
        if (val(el, 'aria-hidden') === 'true' && focusable && val(el, 'tabindex') !== '-1' && !present(el, 'disabled')) {
          add('aria-hidden-focusable', 'major', el, `A focusable <${el.tag}> is aria-hidden="true": keyboard users can focus something screen readers cannot see (WCAG 4.1.2).`, 'Remove aria-hidden, or take the element out of the tab order (tabindex="-1").', { level: 'A', criterion: '4.1.2' });
        }
        if ((NON_INTERACTIVE.has(el.tag) || (el.tag === 'a' && !isLink)) && !present(el, 'tabindex') && !role && CLICK_ATTRS.some((a) => present(el, a)) && hasText(el) && !hasOpaqueChild(el)) {
          add('click-not-keyboard', 'major', el, `A click handler is attached to a <${el.tag}> that is not focusable and has no role (WCAG 2.1.1).`, 'Use a <button> or <a href>.', { level: 'A', criterion: '2.1.1' });
        }
      }
    }

    const total = controls + images + docs;
    if (total === 0) return { notMeasured: 'no form fields, images or full documents (<html>) were found in static markup (components and dynamic fragments are not inspected)', findings };
    return {
      value: (controlsOk + imagesOk + docsOk) / total,
      detail: `${controlsOk}/${controls} form fields labelled (reusable component files are skipped: their consumer supplies the label), ${imagesOk}/${images} images with alt, ${docsOk}/${docs} documents with lang; ${skippedOpaque.dynamic} element(s) with dynamic attributes and all components were skipped. Title, name, iframe, viewport and ARIA findings do not change this share.`,
      findings,
    };
  },
});
