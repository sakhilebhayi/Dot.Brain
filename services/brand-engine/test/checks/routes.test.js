// The Laravel route reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutes, pathMatches, stripPhpComments } from '../../src/analyze/checks/_lib/routes.js';

const SRC = `<?php
use Illuminate\\Support\\Facades\\Route;
Route::get('/', function () { return view('welcome'); })->name('home');
// Route::get('/commented', fn () => 1);
# Route::get('/hash-commented', fn () => 1);
/* Route::get('/block-commented', fn () => 1); */
Route::middleware(['auth'])->prefix('admin')->name('admin.')->group(function () {
    Route::get('/users', [UserController::class, 'index'])->name('users.index');
    Route::resource('photos', PhotoController::class)->only(['index', 'show']);
    Route::prefix('x')->group(function () { Route::view('/about', 'about')->name('about'); });
});
Route::match(['get', 'post'], '/contact', fn () => view('contact'));
Route::apiResource('posts.comments', C::class)->except(['destroy']);
Route::group(['prefix' => 'v1', 'as' => 'v1.'], function () { Route::get('/ping', fn () => 1)->name('ping'); });
Route::fallback(fn () => abort(404));
Route::redirect('/old', '/new');
Route::inertia('/about-us', 'About');
Route::resources(['tags' => TagController::class]);
`;

test('routes, names, prefixes, groups, resources and views', () => {
  const { routes } = parseRoutes(SRC, 'routes/web.php');
  const flat = routes.map((r) => `${r.method} ${r.path} ${r.name ?? '-'} ${r.view ?? '-'}`);
  assert.deepEqual(flat, [
    'GET / home welcome',
    'GET /admin/users admin.users.index -',
    'GET /admin/photos admin.photos.index -',
    'GET /admin/photos/{photo} admin.photos.show -',
    'GET /admin/x/about admin.about about',
    'GET|POST /contact - contact',
    'GET /posts/{post}/comments posts.comments.index -',
    'POST /posts/{post}/comments posts.comments.store -',
    'GET /posts/{post}/comments/{comment} posts.comments.show -',
    'PUT /posts/{post}/comments/{comment} posts.comments.update -',
    'GET /v1/ping v1.ping -',
    'GET * - -',
    'GET /old - -',
    'GET /about-us - -',
    'GET /tags tags.index -',
    'GET /tags/create tags.create -',
    'POST /tags tags.store -',
    'GET /tags/{tag} tags.show -',
    'GET /tags/{tag}/edit tags.edit -',
    'PUT /tags/{tag} tags.update -',
    'DELETE /tags/{tag} tags.destroy -',
  ]);
  assert.equal(routes[0].line, 3);
});

test('comments of all three PHP kinds are ignored', () => {
  const { routes } = parseRoutes(SRC, 'routes/web.php');
  assert.ok(!routes.some((r) => /commented/.test(r.path)));
  assert.equal(stripPhpComments("a // b\n'//not' # c\nd").includes('not'), true);
});

test('path matching: parameters, optional parameters and wildcards for dynamic segments', () => {
  const table = { routes: [{ path: '/' }, { path: '/a/{id}' }, { path: '/b/{x?}' }, { path: '/c.d/{id}/edit' }, { path: '*' }] };
  const yes = ['/', '/a/5', '/b', '/b/3', '/c.d/1/edit', '/a/\u0001', 'a/5'];
  const no = ['/a', '/cxd/1/edit', '/zz', '/a/5/6'];
  for (const p of yes) assert.equal(pathMatches(table, p), true, p);
  for (const p of no) assert.equal(pathMatches(table, p), false, p);
});

test('a broken route file does not throw', () => {
  for (const s of ['<?php Route::', "<?php Route::get('/x'", '<?php Route::get(', "<?php Route::prefix('a')->group(function () {", '<?php Route::resource(1);']) {
    assert.doesNotThrow(() => parseRoutes(s, 'routes/web.php'), s);
  }
});
