/**
 * Git Tools
 *
 * Wraps git commands (status, log, diff, branch) and returns structured
 * JSON. Uses git's porcelain and machine-readable formats to avoid
 * brittle parsing of human-readable output.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "#exec";
import { ok } from "#response";

/** Register all git tools on the MCP server. */
export function registerGitTools(server: McpServer) {
  // ── git status ──────────────────────────────────────────────────────
  server.registerTool("git_status", {
    title: "Git status",
    description:
      "Structured git status: branch, staged/unstaged/untracked files. Replaces parsing raw git status output.",
    inputSchema: {
      cwd: z.string().optional().describe("Repository path"),
    },
    outputSchema: {
      branch: z.string(),
      ahead: z.number(),
      behind: z.number(),
      staged: z.array(z.object({ file: z.string(), status: z.string() })),
      unstaged: z.array(z.object({ file: z.string(), status: z.string() })),
      untracked: z.array(z.string()),
      clean: z.boolean(),
    },
  }, async ({ cwd }) => {
    const opts = cwd ? { cwd } : {};

    const [statusResult, branchResult] = await Promise.all([
      exec("git", ["status", "--porcelain=v2", "--branch"], opts),
      exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts),
    ]);

    const lines = statusResult.stdout.split("\n").filter(Boolean);
    let branch = branchResult.stdout.trim();
    let ahead = 0;
    let behind = 0;
    const staged: { file: string; status: string }[] = [];
    const unstaged: { file: string; status: string }[] = [];
    const untracked: string[] = [];

    // Git porcelain v2 XY status codes → human-readable labels
    const statusMap: Record<string, string> = {
      M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied",
    };

    for (const line of lines) {
      if (line.startsWith("# branch.head ")) {
        branch = line.slice("# branch.head ".length);
      } else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(\d+) -(\d+)/);
        if (match) { ahead = parseInt(match[1]!, 10); behind = parseInt(match[2]!, 10); }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const parts = line.split(" ");
        const xy = parts[1] ?? "..";
        const file = parts.at(-1) ?? "";
        if (xy[0] !== ".") staged.push({ file, status: statusMap[xy[0]!] ?? xy[0]! });
        if (xy[1] !== ".") unstaged.push({ file, status: statusMap[xy[1]!] ?? xy[1]! });
      } else if (line.startsWith("? ")) {
        untracked.push(line.slice(2));
      }
    }

    const clean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
    return ok({ branch, ahead, behind, staged, unstaged, untracked, clean });
  });

  // ── git log ─────────────────────────────────────────────────────────
  server.registerTool("git_log", {
    title: "Git log",
    description:
      "Structured git log: commit hash, author, date, message. Compact and parseable.",
    inputSchema: {
      cwd: z.string().optional().describe("Repository path"),
      count: z.number().optional().default(20).describe("Number of commits (default 20)"),
      author: z.string().optional().describe("Filter by author"),
      since: z.string().optional().describe("Since date (e.g. '2024-01-01')"),
      path: z.string().optional().describe("Filter by file path"),
      withFiles: z.boolean().optional().describe("Include list of files changed per commit"),
    },
    outputSchema: {
      commits: z.array(
        z.object({
          hash: z.string(),
          shortHash: z.string(),
          author: z.string(),
          date: z.string(),
          message: z.string(),
          files: z.array(z.string()).optional(),
        }),
      ),
      count: z.number(),
    },
  }, async ({ cwd, count, author, since, path, withFiles }) => {
    // Unicode separator avoids collisions with commit message content
    const sep = "‖";
    const args = ["log", `--format=%H${sep}%h${sep}%an${sep}%aI${sep}%s`, `-n`, String(count ?? 20)];
    if (withFiles) args.push("--name-only");
    if (author) args.push(`--author=${author}`);
    if (since) args.push(`--since=${since}`);
    if (path) { args.push("--"); args.push(path); }

    const result = await exec("git", args, cwd ? { cwd } : {});

    let commits: {
      hash: string;
      shortHash: string;
      author: string;
      date: string;
      message: string;
      files?: string[];
    }[];

    if (withFiles) {
      // With --name-only, output is: <formatted line>\n\nfile1\nfile2\n\n<next formatted line>...
      // Split on the commit format lines using the separator as anchor
      commits = [];
      const blocks = result.stdout.trim().split(/\n(?=[0-9a-f]{40}‖)/);
      for (const block of blocks) {
        if (!block) continue;
        const lines = block.split("\n");
        const commitLine = lines[0] ?? "";
        const [hash, shortHash, authorName, date, ...msgParts] = commitLine.split(sep);
        const files = lines.slice(1).filter(Boolean);
        commits.push({
          hash: hash ?? "",
          shortHash: shortHash ?? "",
          author: authorName ?? "",
          date: date ?? "",
          message: msgParts.join(sep),
          files,
        });
      }
    } else {
      commits = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, authorName, date, ...msgParts] = line.split(sep);
          return {
            hash: hash ?? "",
            shortHash: shortHash ?? "",
            author: authorName ?? "",
            date: date ?? "",
            message: msgParts.join(sep),
          };
        });
    }

    return ok({ commits, count: commits.length });
  });

  // ── git diff summary ────────────────────────────────────────────────
  server.registerTool("git_diff", {
    title: "Git diff",
    description:
      "Structured git diff: files changed with insertions/deletions counts.",
    inputSchema: {
      cwd: z.string().optional().describe("Repository path"),
      ref: z.string().optional().describe("Ref to diff against (e.g. 'main', 'HEAD~3')"),
      staged: z.boolean().optional().describe("Show staged changes"),
    },
    outputSchema: {
      files: z.array(
        z.object({
          file: z.string(),
          insertions: z.number(),
          deletions: z.number(),
        }),
      ),
      totalInsertions: z.number(),
      totalDeletions: z.number(),
      fileCount: z.number(),
    },
  }, async ({ cwd, ref, staged }) => {
    const args = ["diff", "--numstat"];
    if (staged) args.push("--cached");
    if (ref) args.push(ref);

    const result = await exec("git", args, cwd ? { cwd } : {});

    const files = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ins, del, ...fileParts] = line.split("\t");
        return {
          file: fileParts.join("\t"),
          insertions: ins === "-" ? 0 : parseInt(ins ?? "0", 10),
          deletions: del === "-" ? 0 : parseInt(del ?? "0", 10),
        };
      });

    const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    return ok({ files, totalInsertions, totalDeletions, fileCount: files.length });
  });

  // ── git branch ──────────────────────────────────────────────────────
  server.registerTool("git_branches", {
    title: "Git branches",
    description: "List git branches with current branch marker and last commit info.",
    inputSchema: {
      cwd: z.string().optional().describe("Repository path"),
      remote: z.boolean().optional().describe("Include remote branches"),
    },
    outputSchema: {
      current: z.string(),
      branches: z.array(
        z.object({
          name: z.string(),
          current: z.boolean(),
          lastCommit: z.string(),
          remote: z.boolean(),
        }),
      ),
    },
  }, async ({ cwd, remote }) => {
    const args = ["branch", "-v", "--no-color"];
    if (remote) args.push("-a");

    const result = await exec("git", args, cwd ? { cwd } : {});

    let currentBranch = "";
    const branches = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const isCurrent = line.startsWith("* ");
        const cleaned = line.replace(/^[* ] +/, "");
        const parts = cleaned.split(/\s+/);
        const name = parts[0] ?? "";
        const lastCommit = parts.slice(1).join(" ");
        const isRemote = name.startsWith("remotes/");
        if (isCurrent) currentBranch = name;
        return { name, current: isCurrent, lastCommit, remote: isRemote };
      });

    return ok({ current: currentBranch, branches });
  });
}
