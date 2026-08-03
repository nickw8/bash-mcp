/**
 * Doc renderer tests + generated-file drift guards.
 *
 * Two kinds of claim live here. The unit tests exercise a renderer directly with
 * a hand-built `ToolRecord[]` — cheap, and the only way to reach the throw
 * branches. The guards mirror src/benchmark.fixtures.test.ts: each committed
 * artifact must equal what the renderer produces right now, so a doc can never
 * silently drift from the code. Regenerate intentionally with `npm run docs:tools`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRegistry } from "../registry.js";
import { INTENTS } from "../tools/guidance/guidance.js";
import {
  renderAgentRules,
  renderReadme,
  renderToolDocs,
  renderToolsSection,
  renderWhichToolTable,
} from "./render.js";

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, "..", "..", "docs", "tools.md");
const readmePath = join(here, "..", "..", "README.md");
const rulesPath = join(
  here,
  "..",
  "..",
  "claude",
  "rules",
  "bash-mcp-tools.md",
);

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

  /**
   * The type printer reads Zod 3's `_def.typeName`. A Zod 4 bump removes that,
   * and every field would degrade to `unknown` — a 70-tool doc diff with no
   * failure naming the cause. This fails first, and says why.
   */
  it("prints concrete types for the Zod constructs tools actually declare", () => {
    const md = renderToolDocs([
      {
        name: "printer_probe",
        inputSchema: {
          text: z.string().describe("a string"),
          count: z.number().optional(),
          flag: z.boolean().default(false),
          list: z.array(z.string()),
          choice: z.enum(["a", "b"]),
          either: z.union([z.string(), z.array(z.string())]),
          shape: z.object({ inner: z.string() }),
        },
      },
    ]);
    expect(md).not.toContain(": unknown");
    expect(md).toContain("- `text`: string — a string");
    expect(md).toContain("- `count`: number _(optional)_");
    expect(md).toContain("- `flag`: boolean _(optional)_");
    expect(md).toContain("- `list`: string[]");
    expect(md).toContain('- `choice`: "a" | "b"');
    expect(md).toContain("- `either`: string | string[]");
    expect(md).toContain("- `shape`: object");
  });
});

describe("renderReadme", () => {
  it("throws when a generated region's markers are missing", () => {
    expect(() => renderReadme("# README\n", buildRegistry(), INTENTS)).toThrow(
      /BEGIN GENERATED/,
    );
  });
});

describe("renderAgentRules", () => {
  it("advertises every registered tool so none can silently go missing", () => {
    const tools = buildRegistry();
    const md = renderAgentRules(tools);
    for (const t of tools) {
      expect(md).toContain(`\`${t.name}\``);
    }
  });

  it("renders one row per category with a curated 'instead of' note", () => {
    const md = renderAgentRules(buildRegistry());
    expect(md).toContain("| Category | Use bash-mcp | Instead of |");
    expect(md).toContain("| Liquibase | `liquibase_validate`");
    expect(md).toContain("`Bash(liquibase)`");
  });

  it("throws when a registry category lacks a CATEGORY_AVOID entry", () => {
    const tools = buildRegistry();
    expect(() =>
      renderAgentRules([
        ...tools,
        { name: "fake_tool", category: "Brand New Category" },
      ]),
    ).toThrow(/CATEGORY_AVOID/);
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

describe("claude/rules/bash-mcp-tools.md", () => {
  it("matches the generator output (run `npm run docs:tools` if this fails)", () => {
    const committed = readFileSync(rulesPath, "utf8");
    expect(committed).toBe(renderAgentRules(buildRegistry()));
  });
});
