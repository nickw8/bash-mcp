# Context: bash-mcp

The vocabulary this repo uses. When writing an issue, a test name, or a refactor
proposal, use these terms — not synonyms.

## The product

**bash-mcp** is an MCP server that wraps CLI tools so an agent gets structured JSON
instead of raw terminal text. Every wrapper exists to cut tokens and remove parsing work
from the model, not to add features the underlying CLI lacks.

## Core terms

| Term | Means |
|---|---|
| **Tool** | One MCP-callable operation (`ls`, `kube_get`). Registered with `defineTool`, named in snake_case. |
| **Group** | A directory under `src/tools/<group>/` whose barrel exports `register<Group>Tools(server)`. The unit of registration. |
| **Category** | The README/docs heading a group's tools appear under ("Git", "Kubernetes"). Set per group in the `GROUPS` table; several groups may share one. |
| **Registry** | The module-level list of `ToolRecord`s that `defineTool` populates. The single source for every generated doc. |
| **Renderer** | A pure function from `ToolRecord[]` (plus `INTENTS`) to the text of one generated artifact — `docs/tools.md`, a README region, the agent rules file. Lives in `src/docs/render.ts`, off the server's boot path. See [ADR-0002](docs/adr/0002-registry-generates-all-docs.md). |
| **ToolRecord** | A flattened tool description — name, title, description, readOnlyHint, equivalentCommands, schemas, category. |
| **Diagnostic tool** | A tool that collapses multi-call triage into one answer: `{ status/healthy, likelyCauses[], suggestedNextCommands[], evidence[] }`. |
| **Diagnostic** | A single lint/typecheck/build finding (`file`, `line`, `column`, `severity`, `rule`, `message`). Different thing from a *diagnostic tool*. |
| **Wide event** | The one structured JSON line `defineTool` emits per call, to stderr. |
| **Probe** | A capability check that a CLI is installed (`PROBES` / `runProbe` in `env.ts`), used by `check_environment` and `--doctor`. |
| **Intent** | An entry in guidance `INTENTS` — a task phrased as the user's goal, mapped to a preferred tool and what to avoid. |
| **equivalentCommands** | The raw CLI invocation a tool approximates. Drives `_meta`, the generated docs, and the redirect hook. |
| **Redirect hook** | `hooks/bash-mcp-redirect.sh` — a PreToolUse Bash hook steering agents off raw commands onto the equivalent tool. |
| **Budget** | The `detailLevel` / `maxItems` / `includeRaw` input fragment plus `applyBudget`, capping variable-size lists. |
| **Shaping** | Trimming a command's output to a head/tail window (`shapeOutput` in `src/exec.ts`). |
| **Text block vs structuredContent** | Every response carries both. `structuredContent` is the complete typed payload and **the artifact the agent is charged tokens for** — a client that understands it renders it and ignores the text block. The text block is the compact rendering for clients that don't. They are deliberately not the same. See [ADR-0009](docs/adr/0009-structuredcontent-is-what-the-agent-reads.md). |
| **Mode** | The `BASH_MCP_MODE` safety setting gating mutating `run`/`batch` commands. |
| **Zero payload** | The payload a tool's `outputSchema` describes with every field empty, derived by `zeroOf` and merged under the error result by `defineTool`. An `err(...)` carries only what the zero cannot know. See [ADR-0011](docs/adr/0011-the-outputschema-defines-the-error-payload.md). |
| **Corpus** | `fixtures/benchmarks/` — the `raw.txt` / `expected.txt` pairs. Serves two purposes at once: it prices every tool's payload, and it is the behavioral contract each handler is round-tripped against. `expected.txt` is the contract, not a record. See [ADR-0010](docs/adr/0010-the-benchmark-corpus-is-a-contract-corpus.md). |

## Words to avoid

- **"Command"** for a tool — a command is what the wrapped CLI runs. Tools call commands.
- **"Wrapper"** as a noun for a tool — reserve it for `defineTool` itself.
- **"Error"** for a wrapped command that ran and reported failure. A failing lint or a
  failed validation is a *result* (`ok(...)` with `valid: false`); only an unrunnable
  command is an *error*. See [ADR-0005](docs/adr/0005-wrapped-failure-is-a-result.md).

## Settled decisions

`docs/adr/` holds the decisions that shape this codebase. Read the relevant one before
proposing a change to logging, registration, output shape, or safety defaults — and if
your proposal contradicts one, say so explicitly rather than quietly overriding it.
