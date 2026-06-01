/**
 * Tool registry + generated-doc guard.
 *
 * Mirrors src/benchmark.fixtures.test.ts: the committed docs/tools.md must equal
 * what the generator renders right now, so the reference can never silently drift
 * from the code. Regenerate intentionally with `npm run docs:tools`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  renderReadme,
  renderToolDocs,
  renderToolsSection,
  renderWhichToolTable,
} from "./registry.js";
import { INTENTS } from "./tools/guidance/guidance.js";

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, "..", "docs", "tools.md");
const readmePath = join(here, "..", "README.md");

describe("buildRegistry", () => {
  it("returns one record per registered tool, deduplicated across calls", () => {
    const first = buildRegistry();
    const second = buildRegistry();
    expect(first.length).toBeGreaterThan(0);
    // resetRegistry inside buildRegistry prevents accumulation.
    expect(second.length).toBe(first.length);
    const names = first.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // unique names
  });

  it("includes the guidance + env discovery tools and seeded equivalentCommands", () => {
    const tools = buildRegistry();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.has("list_guidance")).toBe(true);
    expect(byName.has("check_environment")).toBe(true);
    // A representative seeded tool carries its raw-command equivalents.
    expect(byName.get("kube_diagnose_pod")?.equivalentCommands).toContain(
      "kubectl describe pod <pod> -n <ns>",
    );
  });

  it("tags every tool with its group's README category", () => {
    const tools = buildRegistry();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(tools.every((t) => typeof t.category === "string")).toBe(true);
    expect(byName.get("kube_get")?.category).toBe("Kubernetes");
    // Two register groups (git.ts + diff.ts) share the "Git" category.
    expect(byName.get("git_status")?.category).toBe("Git");
    expect(byName.get("git_diff_content")?.category).toBe("Git");
  });
});

describe("renderToolsSection", () => {
  it("groups tools under category headers with a Tool/Description table", () => {
    const md = renderToolsSection(buildRegistry());
    expect(md).toContain("### Kubernetes");
    expect(md).toContain("| Tool | Description |");
    // Description is the first sentence of the tool's MCP description.
    expect(md).toContain(
      "| `kube_get` | Get Kubernetes resources as structured data. |",
    );
  });
});

describe("renderWhichToolTable", () => {
  it("renders intent → preferred tool rows with raw-command anti-patterns", () => {
    const md = renderWhichToolTable(INTENTS);
    expect(md).toContain("| I want to… | Use this | Instead of |");
    expect(md).toContain(
      "| diagnose a crashing or failing Kubernetes pod | `kube_diagnose_pod` |",
    );
    // The `run: ` prefix is stripped from avoid entries for display.
    expect(md).not.toContain("run: kubectl");
    expect(md).toContain("`kubectl describe pod`");
  });
});

describe("renderToolDocs", () => {
  it("is deterministic (sorted; re-render is byte-identical)", () => {
    const tools = buildRegistry();
    expect(renderToolDocs(tools)).toBe(renderToolDocs(tools));
  });

  it("renders an Equivalent commands block only when present", () => {
    const md = renderToolDocs(buildRegistry());
    expect(md).toContain("**Equivalent commands:**");
    expect(md).toContain("argocd app get <name> -o json");
  });
});

describe("docs/tools.md", () => {
  it("matches the generator output (run `npm run docs:tools` if this fails)", () => {
    const committed = readFileSync(docPath, "utf8");
    expect(committed).toBe(renderToolDocs(buildRegistry()));
  });
});

describe("README.md generated regions", () => {
  it("match the registry + intents (run `npm run docs:tools` if this fails)", () => {
    const readme = readFileSync(readmePath, "utf8");
    // renderReadme is idempotent: regenerating the committed README is a no-op.
    expect(readme).toBe(renderReadme(readme, buildRegistry(), INTENTS));
  });
});
