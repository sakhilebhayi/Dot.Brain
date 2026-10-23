# Report template

Fill every line from engine output. Where the engine printed nothing, write "not available" and say why.

```
Brand experience report: <product>
Engine and rubric: <rubric id>@<version> sha256 <sha256 as printed by `rubric show`>
Profile: <id>@<version> (<status>; effective <effective_status>)
Commit analysed: <sha or "not recorded">

Result (from score.json, not recalculated)
- Evidenced score: <x> / 100   Ceiling: <y>   Attainment: <z> %
- State: <state>   Confidence: <band>
- Blockers: <list, or none>

Evidence behind it
- Automated: <n checks measured> of <m>   Expert: <who, human or ai>   Observed or customer: <none | what, n>
- Builder (<id>) assessments: recorded, earned nothing

Not measured (the engine's list, verbatim)
- <check or dimension>: <reason>
- Dimensions 11 and 12: not measured, no real observed or customer data

Open work (from plan.json)
- <task id> <title> (<severity>) ...
- Withheld because safety, regulation, accessibility, security or correctness outranks it: <list>
- Needs a human (engagement items): <list>

What I could not do
- <a step that failed, with the exit code and message>
```

Do not add a sentence about how users feel, how much they will like it, or that the product is ready, unless the engine's state says so. Do not round a number up.
