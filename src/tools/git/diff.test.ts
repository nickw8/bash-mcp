/**
 * Tests for git_diff_content tool.
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGitDiffContentTools, parseDiff } from "./diff.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerGitDiffContentTools(server);
  return server;
}

describe("registerGitDiffContentTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("parseDiff", () => {
  it("parses a single-file single-hunk diff", () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { z } from "zod";
+import { ok } from "#response";

 const x = 1;
`;

    const result = parseDiff(raw);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/app.ts");
    expect(result.files[0]!.insertions).toBe(1);
    expect(result.files[0]!.deletions).toBe(0);
    expect(result.files[0]!.hunks).toHaveLength(1);
    expect(result.files[0]!.hunks[0]!.header).toContain("@@ -1,3 +1,4 @@");
    expect(result.summary).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    });
  });

  it("parses a diff with multiple files", () => {
    const raw = `diff --git a/file1.ts b/file1.ts
index 1111..2222 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 line1
+added line
 line2
diff --git a/file2.ts b/file2.ts
index 3333..4444 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,2 @@
 line1
-removed line
 line2
`;

    const result = parseDiff(raw);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.path).toBe("file1.ts");
    expect(result.files[0]!.insertions).toBe(1);
    expect(result.files[0]!.deletions).toBe(0);
    expect(result.files[1]!.path).toBe("file2.ts");
    expect(result.files[1]!.insertions).toBe(0);
    expect(result.files[1]!.deletions).toBe(1);
    expect(result.summary).toEqual({
      filesChanged: 2,
      insertions: 1,
      deletions: 1,
    });
  });

  it("parses a diff with multiple hunks in one file", () => {
    const raw = `diff --git a/big.ts b/big.ts
index aaaa..bbbb 100644
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,4 @@
 first section
+added at top
 more code
@@ -20,3 +21,4 @@ function foo() {
 bottom section
+added at bottom
 end
`;

    const result = parseDiff(raw);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.hunks).toHaveLength(2);
    expect(result.files[0]!.hunks[0]!.header).toContain("-1,3 +1,4");
    expect(result.files[0]!.hunks[1]!.header).toContain("-20,3 +21,4");
    expect(result.files[0]!.insertions).toBe(2);
    expect(result.files[0]!.deletions).toBe(0);
  });

  it("handles modifications (both insertions and deletions)", () => {
    const raw = `diff --git a/mod.ts b/mod.ts
index 1111..2222 100644
--- a/mod.ts
+++ b/mod.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;

    const result = parseDiff(raw);

    expect(result.files[0]!.insertions).toBe(1);
    expect(result.files[0]!.deletions).toBe(1);
    expect(result.summary.insertions).toBe(1);
    expect(result.summary.deletions).toBe(1);
  });

  it("returns empty result for empty input", () => {
    const result = parseDiff("");
    expect(result.files).toHaveLength(0);
    expect(result.summary).toEqual({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  });
});
