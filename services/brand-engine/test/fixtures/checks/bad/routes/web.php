<?php
use Illuminate\Support\Facades\Route;
Route::get('/', function () { return view('home'); })->name('home');
Route::get('/contact', fn () => view('contact'))->name('contact');
Route::get('/list', fn () => view('list'))->name('list');
