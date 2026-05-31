import { getEncoding } from "js-tiktoken";
import { describe, expect, it } from "vitest";
import { formatList, type ListFormat } from "./format.js";

/**
 * Token-budget regression guard.
 *
 * The compact-format work (docs/token-benchmarks.md) cut the flat-list tools'
 * text output by routing it through formatList with bare/tsv defaults. This test
 * exercises the SAME code path with representative payloads and asserts each
 * default text view (a) stays under a token budget and (b) is strictly smaller
 * than the JSON equivalent — so a regression to ok()/JSON, a broken format, or a
 * field-curation revert fails CI instead of silently inflating token usage.
 *
 * Counts use o200k_base (a GPT proxy for Claude); the relative "beats JSON"
 * check is tokenizer-independent, and budgets carry ~10% headroom.
 */
const enc = getEncoding("o200k_base");
const tok = (s: string) => enc.encode(s).length;

interface BudgetCase {
  name: string;
  format: ListFormat;
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
  budget: number;
}

const CASES: BudgetCase[] = [
  {
    name: "tf_state_list (bare)",
    format: "bare",
    rows: [
      { address: "module.network.aws_vpc.main" },
      { address: "module.network.aws_subnet.public[0]" },
      { address: "module.network.aws_subnet.public[1]" },
      { address: "aws_instance.web" },
      { address: "aws_s3_bucket.logs" },
    ],
    meta: {
      count: 5,
      byType: { aws_vpc: 1, aws_subnet: 2, aws_instance: 1, aws_s3_bucket: 1 },
    },
    budget: 75,
  },
  {
    name: "du (tsv, sizeHuman dropped)",
    format: "tsv",
    rows: [
      { path: "./src/parsers", sizeBytes: 4096 },
      { path: "./src/tools", sizeBytes: 24576 },
      { path: "./src", sizeBytes: 40960 },
      { path: "./fixtures", sizeBytes: 8192 },
      { path: ".", sizeBytes: 61440 },
    ],
    meta: {},
    budget: 42,
  },
  {
    name: "tree (bare)",
    format: "bare",
    rows: [
      { path: "src/index.ts" },
      { path: "src/exec.ts" },
      { path: "src/tools/" },
      { path: "src/tools/git/" },
      { path: "src/tools/git/status.ts" },
      { path: "src/tools/git/log.ts" },
      { path: "src/tools/kubernetes/" },
      { path: "src/tools/kubernetes/kubernetes.ts" },
      { path: "src/parsers/" },
      { path: "src/parsers/types.ts" },
    ],
    meta: { dirs: 5, files: 6 },
    budget: 66,
  },
  {
    name: "git_log (tsv, full hash dropped)",
    format: "tsv",
    rows: [
      {
        shortHash: "a1b2c3d",
        author: "Nick",
        date: "2026-05-30T22:11:04+00:00",
        message: "feat: add retry logic",
      },
      {
        shortHash: "9f8e7d6",
        author: "Nick",
        date: "2026-05-29T10:02:55+00:00",
        message: "fix: handle null token",
      },
    ],
    meta: { count: 2 },
    budget: 85,
  },
  {
    name: "kube_contexts (tsv)",
    format: "tsv",
    rows: [
      { name: "prod", cluster: "prod", namespace: "payments", current: true },
      {
        name: "staging",
        cluster: "staging",
        namespace: "default",
        current: false,
      },
      { name: "dev", cluster: "dev", namespace: "default", current: false },
    ],
    meta: { current: "prod" },
    budget: 34,
  },
];

describe("token budgets (compact-format regression guard)", () => {
  for (const c of CASES) {
    it(`${c.name}: ≤ ${c.budget} tokens and smaller than JSON`, () => {
      const compact = tok(formatList(c.rows, c.format, c.meta));
      const json = tok(formatList(c.rows, "json", c.meta));
      expect(compact).toBeLessThanOrEqual(c.budget);
      expect(compact).toBeLessThan(json);
    });
  }
});
