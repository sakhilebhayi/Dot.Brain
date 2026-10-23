@extends('layouts.app')
@section('content')
<h1>Welcome</h1>
<p>Keep your records in one place.</p>
<img src="/img/hero.png" alt="A tidy desk with a laptop">
<img src="/img/rule.png" alt="">
<a href="{{ route('contact') }}">Contact us</a>
@endsection
