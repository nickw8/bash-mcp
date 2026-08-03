import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler, execFail, execOk } from "../../test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);

const { registerFilesystemTools } = await import("./filesystem.js");

/**
 * Handler behavior the benchmark corpus can't reach: error branches, the tree
 * fallback, and inputs no fixture carries. The corpus pins the happy path for
 * ls/du/tree (src/benchmark.roundtrip.test.ts); this pins the rest.
 */
describe("filesystem handlers", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  describe("find_files", () => {
    it("rejects an unparseable modifiedWithin instead of widening the search", async () => {
      const find = captureHandler(registerFilesystemTools, "find_files");

      const result = await find({ path: ".", modifiedWithin: "last week" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        files: [],
        count: 0,
        ok: false,
        error: { kind: "invalid_input", command: "find" },
      });
      // The bug this replaced: parseTimespan returned 0, `-mmin -0` was pushed,
      // and find silently reported every file as recently modified.
      expect(execMock).not.toHaveBeenCalled();
    });

    it("converts a recognized timespan to -mmin", async () => {
      execMock.mockResolvedValue(execOk("./a.ts\n"));
      const find = captureHandler(registerFilesystemTools, "find_files");

      await find({ path: ".", modifiedWithin: "2h" });

      expect(execMock.mock.calls[0]?.[1]).toContain("-mmin");
      expect(execMock.mock.calls[0]?.[1]).toContain("-120");
    });
  });

  describe("tree fallback", () => {
    it("marks directories when the tree binary is missing", async () => {
      execMock
        // tree itself is not installed
        .mockResolvedValueOnce(execFail("command not found: tree", 127))
        // find: every entry
        .mockResolvedValueOnce(execOk("src\nsrc/index.ts\nsrc/tools\n"))
        // find -type d: which of them are directories
        .mockResolvedValueOnce(execOk("src\nsrc/tools\n"));

      const tree = captureHandler(registerFilesystemTools, "tree");
      const result = await tree({ path: "src" });

      expect(result.structuredContent).toEqual({
        dirs: 2,
        files: 1,
        paths: ["src/", "src/index.ts", "src/tools/"],
      });
    });

    it("skips the second find when only directories were asked for", async () => {
      execMock
        .mockResolvedValueOnce(execFail("command not found: tree", 127))
        .mockResolvedValueOnce(execOk("src\nsrc/tools\n"));

      const tree = captureHandler(registerFilesystemTools, "tree");
      const result = await tree({ path: "src", dirsOnly: true });

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(result.structuredContent).toEqual({
        dirs: 2,
        files: 0,
        paths: ["src/", "src/tools/"],
      });
    });
  });

  describe("ls", () => {
    it("keeps spaces in a filename", async () => {
      execMock.mockResolvedValue(
        execOk(
          "total 8\n-rw-r--r-- 1 nick nick 1.0K 2026-05-31 12:00 my notes.md\n",
        ),
      );

      const ls = captureHandler(registerFilesystemTools, "ls");
      const result = await ls({ path: "." });

      expect(result.structuredContent.entries).toEqual([
        {
          name: "my notes.md",
          size: 1024,
          permissions: "-rw-r--r--",
          modified: "2026-05-31",
        },
      ]);
    });

    it("reports a failed ls instead of an empty listing", async () => {
      execMock.mockResolvedValue(execFail("ls: /nope: No such file"));

      const ls = captureHandler(registerFilesystemTools, "ls");
      const result = await ls({ path: "/nope" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        entries: [],
        total: 0,
        path: "/nope",
      });
    });
  });
});
