import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler, execFail, execOk } from "../../test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);

const { registerSearchTools } = await import("./search.js");

/**
 * rg's exit codes carry the outcome: 0 matched, 1 matched nothing, >= 2 failed.
 * The main rg path always honored that; `filesOnly` and `glob` read stdout
 * without looking, so a rejected regex or an unreadable path came back as a
 * confident "no results". These pin both branches on both paths.
 */
describe("search handlers", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  describe("rg --files-with-matches", () => {
    it("reports a bad pattern as an error", async () => {
      execMock.mockResolvedValue(
        execFail("regex parse error: unclosed group", 2),
      );

      const rg = captureHandler(registerSearchTools, "rg");
      const result = await rg({ pattern: "foo(", filesOnly: true });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        files: [],
        fileCount: 0,
      });
    });

    it("treats no matches as an empty result, not an error", async () => {
      execMock.mockResolvedValue(execFail("", 1));

      const rg = captureHandler(registerSearchTools, "rg");
      const result = await rg({ pattern: "nothing", filesOnly: true });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent.fileCount).toBe(0);
    });
  });

  describe("glob", () => {
    it("reports a rejected glob as an error", async () => {
      execMock.mockResolvedValue(execFail("error parsing glob '['", 2));

      const glob = captureHandler(registerSearchTools, "glob");
      const result = await glob({ pattern: "[" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        files: [],
        count: 0,
      });
    });

    it("returns the matched paths on success", async () => {
      execMock.mockResolvedValue(execOk("src/a.ts\nsrc/b.ts\n"));

      const glob = captureHandler(registerSearchTools, "glob");
      const result = await glob({ pattern: "*.ts" });

      expect(result.structuredContent).toEqual({
        files: ["src/a.ts", "src/b.ts"],
        count: 2,
      });
    });
  });
});
