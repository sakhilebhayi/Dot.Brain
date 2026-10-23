# brand/

Reviewed knowledge data for the Brand Feeling Engine ([ADR-0021](../adr/ADR-0021-brand-feeling-engine.md), [brain.brand_experience.md](../brain.brand_experience.md)). Data lives here, code lives in [services/brand-engine](../services/brand-engine/README.md), and `.github/CODEOWNERS` routes every change under `/brand/` to the owner.

```
brand/framework/principles/BXP-NN-<slug>.json   the 12 framework principles
brand/profiles/<id>.profile.json                dot-ecosystem, infodot, blupin
brand/rubrics/                                  the Brand Experience Quality Score rubric (released, immutable, proposed)
```

Rules for anything stored here:

- **Public only.** This repository is public. Nothing private or personal, and every profile is classification `public`.
- **No product profiles.** A product keeps its own profile in its own repository and `extends` one of these by `id@version`.
- **Nothing is ratified by an AI session.** New and changed files are `draft` or `proposed`. Only the owner sets `ratified`, with `approver` and `ratified_at`, in a reviewed pull request.
- **Feelings are intended, never measured.** Evidence on every assertion, with a class (see the ADR).
- **A released rubric is immutable.** Its hash is in `rubrics/released.json` and in every report; a change is a new version (see [rubrics/README.md](rubrics/README.md)).
- **Validate before you commit:** `node services/brand-engine/src/cli.js profile validate` and `... rubric validate`.
