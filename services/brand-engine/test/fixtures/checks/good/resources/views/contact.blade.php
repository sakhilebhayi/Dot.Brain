@extends('layouts.app')
@section('content')
<h1>Contact</h1>
<form action="/contact" method="post">
  @csrf
  <label for="name">Name</label>
  <input type="text" id="name" name="name">
  <label>Message <textarea name="message"></textarea></label>
  <button type="submit">Send</button>
</form>
@endsection
