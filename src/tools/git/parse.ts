/**
 * Pure git output parsers shared by the higher-level git tools
 * (repo_health_summary, git_pr_context). Pure + co-located tests.
 */

/** Unicode separator for `git log --format` (avoids commit-message collisions). */
export const COMMIT_SEP = "‖";
/** Log format producing hash, shortHash, author, ISO date, subject. */
export const COMMIT_FORMAT = `%H${COMMIT_SEP}%h${COMMIT_SEP}%an${COMMIT_SEP}%aI${COMMIT_SEP}%s`;

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

/** Parse `git log --format=COMMIT_FORMAT` output into commits. */
export function parseCommits(stdout: string): GitCommit[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, author, date, ...msg] = line.split(COMMIT_SEP);
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        author: author ?? "",
        date: date ?? "",
        message: msg.join(COMMIT_SEP),
      };
    });
}

/** Parse `git diff --shortstat` ("N files changed, M insertions(+), K deletions(-)"). */
export function parseShortstat(stdout: string): {
  files: number;
  insertions: number;
  deletions: number;
} {
  const files = /(\d+) files? changed/.exec(stdout)?.[1];
  const insertions = /(\d+) insertions?\(\+\)/.exec(stdout)?.[1];
  const deletions = /(\d+) deletions?\(-\)/.exec(stdout)?.[1];
  return {
    files: Number(files ?? 0),
    insertions: Number(insertions ?? 0),
    deletions: Number(deletions ?? 0),
  };
}

/** Parse `git diff --name-status` into {status, file} rows. */
export function parseNameStatus(
  stdout: string,
): Array<{ status: string; file: string }> {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status ?? "", file: rest.join("\t") };
    });
}

/** Parse `git status -b --porcelain=v2` into branch + change counts. */
export function parseBranchStatus(stdout: string): {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  clean: boolean;
} {
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1] ?? 0);
        behind = Number(m[2] ?? 0);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.split(" ")[1] ?? "..";
      const [x, y] = xy;
      if (x && x !== ".") staged++;
      if (y && y !== ".") unstaged++;
    } else if (line.startsWith("u ")) {
      unstaged++; // unmerged path
    } else if (line.startsWith("? ")) {
      untracked++;
    }
  }

  const clean = staged === 0 && unstaged === 0 && untracked === 0;
  return { branch, ahead, behind, staged, unstaged, untracked, clean };
}
