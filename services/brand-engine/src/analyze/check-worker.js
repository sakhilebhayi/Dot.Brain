// services/brand-engine/src/analyze/check-worker.js
//
// Runs ONE check module in a worker thread, so a check that loops forever,
// exhausts memory or throws cannot take the engine down, and so the timeout is
// real (a worker is terminated; a synchronous loop in the main thread could
// not be). The worker builds its own ctx from plain data: the root, the
// resolved profile and the themes. The worker has an empty environment and
// its console output is discarded.
//
// mode "meta": import the module and report its shape.
// mode "run":  import, validate, ask appliesTo(ctx), run(ctx), post the raw result.
import { parentPort, workerData } from 'node:worker_threads';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCheckModule } from './check-shape.js';
import { createFiles } from './files.js';

const post = (message) => parentPort.postMessage(message);

try {
  const { mode, file, root, profile, themes } = workerData;
  const imported = await import(pathToFileURL(file).href);
  const mod = imported.default;
  const problems = validateCheckModule(mod, basename(file));
  if (problems.length) {
    post({ kind: 'invalid', problems });
  } else if (mode === 'meta') {
    post({ kind: 'meta', meta: { id: mod.id, dimension: mod.dimension, title: mod.title } });
  } else {
    const files = createFiles(root);
    const ctx = Object.freeze({ root: files.root, profile, files: files.api, themes: Object.freeze([...themes]) });
    const meta = { id: mod.id, dimension: mod.dimension, title: mod.title };
    post({ kind: 'ready', meta }); // so a timeout or crash can still be attributed to this check
    if (!(await mod.appliesTo(ctx))) post({ kind: 'not_applicable', meta, skipped: files.skipped() });
    else {
      const result = await mod.run(ctx);
      post({ kind: 'result', meta, result, skipped: files.skipped() });
    }
  }
} catch (error) {
  post({ kind: 'error', message: error && error.message ? String(error.message) : String(error) });
}
