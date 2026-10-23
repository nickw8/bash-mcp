# ADR-0017: Budget rows are atomic, and log lists keep the tail

- **Status:** Accepted
- **Date:** 2026-10-23 (v5)
- **Amends:** [ADR-0015](0015-definetool-fits-every-result-to-a-budget.md)

## Context

ADR-0015 cuts the biggest array to a prefix. Two cases broke that:

- `fitToBudget` collected every array, including the elements of a row list. v5's
  positional rows (`du`'s `[path, sizeBytes]`, `ls`'s 4-tuple) are arrays, so a payload
  down to one oversized row had that row cut to `[path]`. That no longer matches the
  tool's `outputSchema`.
- A prefix of a log is its oldest lines. `kube_logs` asks kubectl for the newest N
  lines (`--tail`), and a cut then threw those away first. `maxItems` did the same.

## Decision

- An array that is an element of another array is a row, and the budget never cuts
  it or anything inside it. Arrays inside an object row (`errors[].items`) are still
  cut.
- `defineTool` takes `budgetTail: string[]`, naming top-level arrays whose newest
  items are last. A cut keeps their suffix, and the `omitted` entry says
  `"from": "tail"`. `applyBudget` takes the same `{ tail }` option for `maxItems`.

## Consequences

- A cut payload still validates against its `outputSchema`.
- An `rg` row (`[file, "line:text", …]`) is no longer cut. `rg`'s own `maxResults` and
  `maxPerFile` bound it.
- The head case is byte-identical to ADR-0015: `from` appears only on a tail cut.
- `result_get` is unchanged; it pages the stored full payload from offset 0.
