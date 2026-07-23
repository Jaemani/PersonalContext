# Core engineering gates

Use these gates only when the repository does not define a stronger local
contract.

## Implementation

- Confirm the requested observable outcome.
- Reuse an established local pattern before adding an abstraction.
- Keep the change coherent and bounded.
- Preserve unrelated user work.

## Diagnosis

- Separate observed failure signals from hypotheses.
- Prefer a discriminating check over speculative edits.
- Explain the cause before changing behavior when the request is diagnosis-only.

## Verification

- Run the repository's documented checks.
- Prefer authoritative behavior checks over file-presence claims.
- Do not claim a command passed unless it was run successfully.
- State what could not be verified and why.

## Documentation

- Update documentation when behavior, a public interface, an operational
  procedure, or a durable architectural boundary changed.
- Avoid plans, ADRs, and summaries that merely restate a small code edit.

## Completion

- Lead with the result.
- Cite the most relevant verification.
- Name residual risk without inflating routine uncertainty.
