# Learner code review

Pathway returns two kinds of feedback for code exercises:

- **Correctness feedback** comes from the sandbox evaluator when it is configured. It determines whether a solution can progress.
- **Code review suggestions** are lightweight, deterministic heuristics. They are advisory and never change a pass/fail result.

The review checks are deliberately narrow and explainable. They currently flag very long lines and a small set of high-signal readability or idiom opportunities:

- Python: boolean comparisons to `True`/`False`, broad `except Exception`, string concatenation suitable for an f-string, and missing return annotations on functions.
- C#: `string.Format`, `== null` / `!= null`, `.Count() > 0`, and verbose collection initialization that may be simplified with modern collection expressions.

Each suggestion is phrased as a consideration, not a command. The review does not claim to understand product intent, naming quality, security posture, or architectural fitness; those remain human-review concerns.

## Safety and availability

The API never runs learner code itself. In production, code execution requires the private evaluator service configured through `EVALUATOR_URL`. If it is unavailable, Pathway still returns the static review but does not mark the exercise complete. This preserves feedback availability without weakening the untrusted-code execution boundary.

## Future improvements

Add language-aware linting and type-checker diagnostics inside the isolated evaluator, retain rule IDs and severity, and allow learners to request an explanation or suppress a suggestion with a reason. Those capabilities should remain transparent about tool version and never silently alter progression rules.
