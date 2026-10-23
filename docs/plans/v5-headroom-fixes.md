# Plan: fixes from the Headroom benchmark handoff

Source: `~/.claude/handoff/engineer-claude/headroom-benchmark_bash-mcp.md` (tested 4.0.0).
Re-checked against `406a4f7`. Correctness first, then size. Each phase is one commit,
and each one passes `npm run lint && npm run typecheck && npm test && npm run docs:tools -- --check`
before the next phase starts.

## Status of the handoff items at 406a4f7

| # | Handoff claim | At HEAD |
|---|---|---|
| 1 | `kube_get` shows CrashLoopBackOff as `Running` | True. `summarizeResource` reads `status.phase` (`src/tools/kubernetes/parse.ts:87`) |
| 2 | No exit-code evidence for a non-OOM crash | True. The CrashLoopBackOff rule reads only `state.waiting` (`diagnose.ts:50`) |
| 3 | `planFile` path double-counts a replace | Wrong path. Terraform counts a replace as add + destroy, so `planFile` (8/1/2) is right. The stream path counts `"replace"` as 0/0/0, counts `resource_drift`, and ignores `change_summary` (`terraform.ts:245`) |
| 4 | `kube_logs` 35% over raw | True, plus two v5 problems: the budget and `maxItems` both keep the oldest lines |
| 5 | Schema ~108k chars | 104k chars now. 12,806 model tokens; 1,842 of them are text-only or duplicate budget parameters |
| 6 | No output-class hint | True. Deferred (see below) |
| — | Not in the handoff | `fitToBudget` descends into tuple rows, so a single oversized row can be cut below its arity and fail `outputSchema` |

## Phase 1 — Pod status the way kubectl prints it (fix 1)

- Add `podStatus(pod: KubeResource): string` to `src/tools/kubernetes/parse.ts`. It is a
  port of kubectl's `printPod` STATUS rule:
  1. Start from `status.reason`, else `phase`.
  2. Init containers: a non-zero terminated exit gives `Init:<reason>`, or
     `Init:Signal:N` / `Init:ExitCode:N`. A waiting reason other than `PodInitializing`
     gives `Init:<reason>`. Otherwise `Init:i/n`.
  3. App containers, checked last to first: the waiting reason, else the terminated
     reason, else `Signal:N` / `ExitCode:N`.
  4. `Completed` with a running, ready container gives `Running`.
  5. A `deletionTimestamp` gives `Terminating`, or `Unknown` when the reason is `NodeLost`.
- `summarizeResource` uses `podStatus` when the item has `containerStatuses` or
  `kind === "Pod"`; other kinds keep phase/conditions.
- `diagnosePod` falls back to `podStatus` instead of `phase`
  (`diagnose.ts:141`). There is one status rule, so `kube_get` and the diagnostics can't
  disagree.
- Tests: a table test per branch, with fixtures shaped like `qa/api-041` and `qa/api-197`.
  Update the `kube_get` fixture `expected.txt` only if its pods hit a changed branch; that
  is a contract change (ADR-0010).
- Token effect: none (same field).

## Phase 2 — Crash evidence carries the last exit (fix 2)

- In `diagnose.ts`, add a `lastExit(c)` helper. It renders `lastState.terminated` as
  `last exit <code> (<reason>)`, plus `: <message>` capped at 200 chars — the termination
  message is often the panic line.
- The CrashLoopBackOff evidence becomes
  `container "app" is CrashLoopBackOff; last exit 1 (Error)`. The `Restarting` fallback
  gets the same suffix.
- `terminatedReason` (OOMKilled) is unchanged. A pod with both rules keeps both lines, as
  now.
- Tests: `api-197` evidence names exit 1 / `Error`; `api-041` still names `OOMKilled (exit 137)`.
- Token effect: about 8 tokens per crashing container. This is the evidence the
  diagnosis needs.

## Phase 3 — One action vocabulary for both plan paths (fix 3)

- In `src/tools/terraform/parse.ts`, add `planAction(actions: string[] | string)`. It
  returns `create | update | delete | replace | read | no-op`.
  `["delete","create"]`, `["create","delete"]` and the stream's `"replace"` all map to
  `replace`.
- `tallyActions` takes the normalized action: `replace` counts add + destroy, matching
  terraform's own `Plan:` line; `read` and `no-op` count nothing.
- Stream path (`terraform.ts`):
  - Skip `resource_drift`. Drift is not a planned change.
  - Take the counts from the `change_summary` message (`changes.add/change/remove`) when
    present; fall back to the tally.
  - Delete the stderr `N to add` regex. With `-json`, terraform and OpenTofu write the
    summary to stdout as `change_summary`.
- `planFile` path: the `action` label becomes `replace` instead of `delete,create`, so a
  change is 1 token instead of 3.
- Tests: the same plan through both paths gives identical `add/change/destroy` and
  `changes`. Add a stream fixture with a `replace`, a `resource_drift`, and a `change_summary`.
- `tf_plan_summary` fixture `expected.txt` changes only if it contains a replace.

## Phase 4 — Budget: atomic rows and tail-first lists (prerequisite for 5)

Amends ADR-0015, which says "order-preserving prefix". Record that as ADR-0017.

- **Atomic rows.** `collectArrays` stops descending into an array that is an element of
  another array. A tuple row (`du`'s `[path, sizeBytes]`, `ls`'s 4-tuple) is never cut.
  Arrays inside objects are still cut (`errors[].items`).
  - Trade-off: `rg`'s `[file, ...lines]` row becomes uncuttable too. It is already bounded
    by `maxResults` (30) and `maxPerFile`.
  - Test: `{ entries: [["x".repeat(20_000), 1]] }` stays a 2-tuple, and the result still
    validates against `du`'s `outputSchema`.
- **Tail-first lists.** Add a `defineTool` config field `budgetTail?: string[]`, naming the
  top-level arrays whose newest items are at the end. `fitToBudget(payload, limit, { tail })`
  keeps `arr.slice(-keep)` for those paths. `Omission` gains `from: "tail"` only when it
  applies; the head case stays byte-identical.
  - `result_get` needs no change: it pages the stored full payload.
  - `budgetTail` is recorded on the `ToolRecord` so `docs/tools.md` can say "keeps the
    newest lines".
- `applyBudget` (`src/parsers/schemas.ts:150`) takes the same `{ tail }` option, so
  `maxItems` on `kube_logs` keeps the newest lines too.
- Token effect: none on the corpus; correctness of what a cut shows.

## Phase 5 — `kube_logs` rows as strings (fix 4)

- Payload is `{ lines: string[] }`. Each row is `"<timestamp> <message>"`, the line as
  kubectl printed it, merged by `collapseRepeats(lines, lineKey, markRepeat)`.
  - Drop `count` (the array length) and `pod` (an echo of the input), as D14 did for `ls`.
  - Keep `total` / `truncated` only when `maxItems` bites.
- `grep` matches the message part (`lineKey(line)`), as now.
- Declare `budgetTail: ["lines"]`.
- Description: "Returns lines as kubectl prints them, `<timestamp> <message>`, oldest
  first; a budget cut keeps the newest."
- Fixtures: `kube_logs` and `kube_logs_repeats` `expected.txt` get the new shape. Add a
  400-line fixture to reproduce the handoff's case and record it in token-benchmarks.md.
- Expected: about +3% over raw (quotes and commas only), against +35%. For the 400-line
  case, `auto` then keeps the newest ~16k chars instead of the oldest.
- CHANGELOG breaking entry; checklist D16.

## Phase 6 — Schema: remove parameters that save the agent nothing (fix 5) — needs a decision

The model sees 12,806 tokens. Measured costs:

- **`format` + `fields` on 19 tools: 1,086 tokens.** Per ADR-0009/0012 they shape only the
  text block, which a `structuredContent` client discards. Remove them from
  `inputSchema` and keep each tool's current default text format.
  - This contradicts part of ADR-0006: the text block format becomes fixed per tool.
    Record that as ADR-0018.
  - Risk: ADR-0014 refuses undeclared arguments, so a client still sending `format` gets
    `invalid_input`. Tolerate and ignore `format`/`fields` for one major instead.
- **Per-tool `detailLevel` + `maxItems` on 12 tools: 756 tokens.** These duplicate the
  central budget (ADR-0015). Option: keep only `maxItems` where it means "N rows" to the
  agent (`kube_logs`, `kube_get`), and move `detailLevel: "full"` to the env mode.
  Smaller win and less clear; measure after the `format` removal.
- Gate: `src/benchmark.gate.test.ts` already fails on growth. Record the new figure in
  token-benchmarks.md and tool-discovery.md.
- Expected: about −1.1k model tokens (−8.5%) from `format`/`fields` alone.

## Deferred

- **Output-class `_meta` hint (6).** No consumer exists; Headroom is not adopted. If it
  is, derive the class from what is already declared: `diagnostic: true` gives
  `diagnostic`, `destructiveHint` / plan tools give `safety-critical`, list tools give
  `enumerative`. No per-tool hand tagging.
- **Drift reporting in `tf_plan_summary`.** Phase 3 stops counting drift as change. A
  separate `drifted: string[]` field waits until someone asks for it.

## Cross-repo

When Phase 5 or 6 ships, reply on the handoff: v5 added `result_get`, `kube_logs` changed
shape, and `format`/`fields` are gone. engineer-claude's redirect table has to follow.
Use the handoff skill for the update.

## Order and size

Phases 1, 2, 3 are independent, small, and don't break anything (fixture contracts
aside). 4 must land before 5. 6 is independent and breaking, and needs a yes on the
ADR-0006 change before it starts.
