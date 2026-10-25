<?php
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
Route::get('/', function () { return view('home'); })->name('home');
Route::get('/contact', fn () => view('contact'))->name('contact');
Route::get('/privacy', fn () => view('privacy'))->name('privacy');
Route::get('/terms', fn () => view('terms'))->name('terms');
Route::get('/up', function () {
    try {
        DB::connection()->getPdo();
    } catch (\Throwable $e) {
        abort(503);
    }
    return response('OK');
})->name('up');
