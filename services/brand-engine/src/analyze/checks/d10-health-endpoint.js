// d10.health_endpoint: three things should be true of a health endpoint: it exists, it answers, and it
// reports failure honestly. Static analysis can establish only the first and part of the third, so the
// share counts what was seen out of three and leaves "answers" at zero: 1/3 when a route exists, 2/3 when its
// handler also shows a failure path (a 5xx status, an exception handler, a dependency probe). A health route
// that is registered by a package is invisible here and reported as not found unless the package is known.
import { defineCheck } from './_lib/define.js';
import { routeTable, composerPackages } from './_lib/routes.js';
import { lineIndex } from './_lib/repo.js';

const ID = 'd10.health_endpoint';
const HEALTH_PATH = /^\/(?:api\/)?(?:up|health|healthz|healthcheck|health-check|_health|status|ping|ready|readyz|live|livez)$/;
const FAILURE = /\b(?:503|500|abort\s*\(|status\s*\(\s*5\d\d|catch\s*\(|getPdo\s*\(|DB::|Redis::|Cache::(?:put|get)|Storage::|Queue::|->ping\(|throw\b)/;

export default defineCheck({
  id: ID,
  title: 'Health endpoint exists and shows a failure path (static)',
  noUiReason: 'no server route definitions (routes/ or bootstrap/app.php) found: nothing to expose a health endpoint',
  applies: (repo) => repo.hasDir('routes') || repo.exists('bootstrap/app.php'),
  measure(repo) {
    const table = routeTable(repo);
    const findings = [];
    let exists = false;
    let failure = false;
    let where = null;
    let how = '';

    const bootstrap = repo.read('bootstrap/app.php');
    const builtIn = bootstrap ? /health\s*:\s*['"](\/[^'"]*)['"]/.exec(bootstrap) : null;
    if (builtIn) {
      exists = true;
      where = { file: 'bootstrap/app.php', line: lineIndex(bootstrap)(builtIn.index) };
      how = `framework health route ${builtIn[1]}`;
      const listener = repo.listAll((r) => /^app\/.+\.php$/.test(r)).some((r) => /DiagnosingHealth/.test(repo.read(r) ?? ''));
      failure = listener;
      if (!listener) how += ' with no DiagnosingHealth listener (it answers 200 whenever the app boots)';
    }
    for (const r of table.routes) {
      if (!HEALTH_PATH.test(r.path)) continue;
      exists = true;
      where = where ?? { file: r.file, line: r.line };
      how = how || `route ${r.path}`;
      const src = repo.read(r.file) ?? '';
      const lines = src.split('\n');
      const window = lines.slice(r.line - 1, r.line + 24).join('\n').split(/\nRoute::/)[0];
      let handlerSrc = window;
      const cls = /\[\s*([A-Z]\w+)::class/.exec(window)?.[1] ?? /([A-Z]\w+)::class/.exec(window)?.[1];
      if (cls) {
        const file = repo.listAll((p) => p.endsWith(`/${cls}.php`) && p.startsWith('app/'))[0];
        if (file) handlerSrc += `\n${repo.read(file) ?? ''}`;
      }
      if (FAILURE.test(handlerSrc)) failure = true;
    }
    const pkgs = composerPackages(repo);
    if (!exists && (pkgs.has('spatie/laravel-health') || pkgs.has('pragmarx/health'))) {
      exists = true;
      how = 'a health package is installed (routes are registered by the package and not visible here)';
    }

    if (!exists) {
      findings.push({ rule: 'health-endpoint-missing', severity: 'major', message: 'No health endpoint (/up, /health, /healthz, /status, ...) was found in routes/*.php or bootstrap/app.php.', file: 'routes', line: 1, hint: 'Add a health route that checks the database and returns a 5xx status when a dependency is down.' });
    } else if (!failure) {
      findings.push({ rule: 'health-failure-path-not-seen', severity: 'minor', message: `The health endpoint (${how}) shows no failure path: no 5xx status, exception handling or dependency probe was found in its handler.`, file: where?.file, line: where?.line, hint: 'Make the endpoint return a 503 when the database or another required dependency fails, so monitoring is told the truth.' });
    }
    return {
      value: ((exists ? 1 : 0) + (failure ? 1 : 0)) / 3,
      detail: `exists: ${exists ? `yes (${how})` : 'no'}; answers: not measured (needs a running app); reports failure honestly: ${failure ? 'a failure path is present in the handler' : 'not seen'}. The share is out of three, so it cannot exceed 2/3 statically.`,
      findings,
    };
  },
});
