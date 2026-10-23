# End-to-end fixture (synthetic)

`product/` is a **made-up product repository** with three seeded defects, and `checks/` holds three
**fixture check modules** that detect exactly those defects. Neither is a real product or a real
check: the checks are deliberately tiny stand-ins so the analyse, plan, verify and score workflow can
be tested without depending on the built-in checks (they live in `src/analyze/checks/`).

Seeded defects in `product/`:

| Defect | Where | Fixture check | Rubric check id |
|---|---|---|---|
| low-contrast token pair (`--text` on `--bg`, about 2.8:1) | `src/tokens.css` | `checks/d8-token-pair-contrast.js` | `d8.token_pair_contrast` (WCAG 1.4.3 AA) |
| image with no alt text | `public/index.html` | `checks/d8-labels-alt-lang.js` | `d8.labels_alt_lang` (WCAG 1.1.1 A) |
| unsupported claim ("Trusted by 10,000 businesses") | `public/index.html` | `checks/d6-claim-lint.js` | `d6.claim_lint` |

The tests copy `product/` to a temporary directory before touching it; nothing here is edited in place.
