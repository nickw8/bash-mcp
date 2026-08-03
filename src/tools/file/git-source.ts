/**
 * Git Source
 *
 * Reading a file out of git, for the file tools. `cat --ref` and `outline --ref`
 * both need the same three steps — locate the repo, read the blob, describe the
 * commit — and used to spell them out separately, 300 lines apart.
 *
 * Locating the repo is the expensive step (a `rev-parse` spawn), so it is its
 * own call: a caller resolves once and hands the {@link Repo} to everything else.
 */

import { exec } from "#exec";

/** A file located inside a git repo: the repo root, and the path relative to it. */
export interface Repo {
  /** Absolute path of the repo root (`git rev-parse --show-toplevel`). */
  root: string;
  /** `filePath` relative to `root` — the form `git show ref:path` expects. */
  relPath: string;
}

/** Content read from a ref, or the reason it could not be read. */
export interface RefContent {
  content: string | null;
  error: string | null;
}

/** Git branch and last-touching commit; nulls when either lookup fails. */
export interface GitMeta {
  branch: string | null;
  commit: string | null;
}

const NO_META: GitMeta = { branch: null, commit: null };

/**
 * Locate the git repo containing `filePath`. Returns null when the file is not
 * in one — the caller decides whether that is an error (`--ref` was asked for)
 * or just an absent branch/commit.
 */
export async function resolveRepo(filePath: string): Promise<Repo | null> {
  const dir = filePath.replace(/\/[^/]*$/, "") || ".";
  const result = await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) return null;
  const root = result.stdout.trim();
  return {
    root,
    relPath: filePath.startsWith(root)
      ? filePath.slice(root.length + 1)
      : filePath,
  };
}

/** Read the file's content at `ref` (`git show ref:path`). */
export async function readAtRef(repo: Repo, ref: string): Promise<RefContent> {
  const result = await exec("git", [
    "-C",
    repo.root,
    "show",
    `${ref}:${repo.relPath}`,
  ]);
  if (result.exitCode !== 0) {
    return {
      content: null,
      error: result.stderr || `Cannot read ${ref}:${repo.relPath}`,
    };
  }
  return { content: result.stdout, error: null };
}

/**
 * Current branch, plus the last commit that touched this file at `ref`
 * (default HEAD). A null `repo` — the file is not in a git repo — yields nulls
 * rather than an error, because branch/commit are decoration on the payload.
 */
export async function gitMeta(
  repo: Repo | null,
  ref?: string,
): Promise<GitMeta> {
  if (!repo) return NO_META;

  const [branchResult, commitResult] = await Promise.all([
    exec("git", ["-C", repo.root, "rev-parse", "--abbrev-ref", "HEAD"]),
    exec("git", [
      "-C",
      repo.root,
      "log",
      "-1",
      "--format=%H",
      ref ?? "HEAD",
      "--",
      repo.relPath,
    ]),
  ]);

  return {
    branch:
      branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    commit:
      commitResult.exitCode === 0 ? commitResult.stdout.trim() || null : null,
  };
}
