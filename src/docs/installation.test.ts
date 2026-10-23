/**
 * The client configs in docs/guides/installation.md are copy-paste targets, so
 * each must parse and start the published package. The server itself is
 * exercised over real stdio in transport.stdio.test.ts; this holds the docs to
 * the same command.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const guide = readFileSync(
  join(root, "docs", "guides", "installation.md"),
  "utf8",
);
const blocks = (lang: string) =>
  [
    ...guide.matchAll(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``, "g")),
  ].map((m) => m[1]);

type Entry = { command: string; args: string[]; type?: string };

describe("installation guide client configs", () => {
  const configs = blocks("json").map((b) => JSON.parse(b));

  it("has a config for each JSON client", () => {
    // Claude Code .mcp.json, Claude Desktop, Cursor (mcpServers); VS Code (servers)
    expect(configs.filter((c) => c.mcpServers)).toHaveLength(3);
    expect(configs.filter((c) => c.servers)).toHaveLength(1);
  });

  it.each(
    configs.map((c, i) => [i, c]),
  )("config %i starts npx -y %s", (_i, config) => {
    const entry = (config.mcpServers ?? config.servers)["bash-mcp"] as Entry;
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", pkg.name]);
    if (entry.type !== undefined) expect(entry.type).toBe("stdio");
  });

  it("Codex TOML names the same command", () => {
    const [toml] = blocks("toml");
    expect(toml).toContain("[mcp_servers.bash-mcp]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain(`args = ["-y", "${pkg.name}"]`);
  });

  it("every documented env var is one the server reads", () => {
    const vars = [...guide.matchAll(/^\| `(BASH_MCP_[A-Z_]+)`/gm)].map(
      (m) => m[1],
    );
    expect(vars.length).toBeGreaterThan(3);
    const src = [
      "src/budget.ts",
      "src/registry.ts",
      "src/result-store.ts",
      "src/logger.ts",
      "src/safety.ts",
    ]
      .map((f) => {
        try {
          return readFileSync(join(root, f), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    for (const v of vars) expect(src, v).toContain(v);
  });
});
