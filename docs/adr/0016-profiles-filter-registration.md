# ADR-0016: Profiles filter which groups register; the default is all

- **Status:** Accepted
- **Date:** 2026-10-23 (v5)
- **Relates to:** [ADR-0002](0002-registry-generates-all-docs.md)

## Context

Sixty-five tool definitions cost ~12.7k model tokens before the first call. Clients
without on-demand tool loading pay that every session. VS Code caps a request at 128
tools across all servers.

## Decision

Each `GROUPS` entry in `src/registry.ts` declares its `profiles`: `core`, or a list of
`development`/`infrastructure`. `BASH_MCP_PROFILE` selects one; `all` registers every
group and is the default. An unknown value stops startup.

## Consequences

- An upgrade drops no tools; trimming is opt-in.
- A profile changes what is listed, not what is allowed. `BASH_MCP_MODE` still gates
  `run` and `batch`.
- Docs are generated from the `all` registry, so every tool stays documented.
