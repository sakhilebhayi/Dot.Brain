@extends('layouts.app')
@section('content')
<h1>Welcome</h1>
<h3>Why us</h3>
<p>Our seamless platform is trusted by 5,000 businesses worldwide.</p>
<p>Earn guaranteed returns with bank-grade security.</p>
<img src="/img/hero.png">
<img src="/img/ok.png" alt="">
<form action="/contact" method="post">
  <input type="text" name="name" placeholder="Name">
  <label for="email">Email</label>
  <input type="email" id="email" name="email">
</form>
<button class="x"><i class="icon"></i></button>
<a href="{{ route('nope') }}" class="outline-none">Go</a>
<p>Lorem ipsum dolor sit amet</p>
<p>Only 3 left — hurry!</p>
<a href="{{ route('contact') }}">Contact</a>
@endsection
