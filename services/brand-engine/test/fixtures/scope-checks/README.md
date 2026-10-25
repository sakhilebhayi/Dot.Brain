FIXTURE check module for the scope tests. It uses a real rubric check id and only reports the `ctx.scope` it was given, so a test can
see that `analyze --scope` reaches a check running in its worker thread. It is not a real check.
