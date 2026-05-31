#!/usr/bin/env node
/**
 * token-benchmark.mjs — one-off token-savings benchmark (NOT a test).
 *
 * Compares the token count of RAW CLI text output against the STRUCTURED JSON
 * bash-mcp returns for the same operation. Prints a table and the relative
 * reduction per command, plus an aggregate.
 *
 * Tokenizer: js-tiktoken `o200k_base` (GPT-4o/o200k). This is a GPT tokenizer
 * used here as a PROXY for Claude's tokenizer — absolute counts will differ
 * from Claude's, but the *relative reduction* (the headline figure) is robust
 * across tokenizers. Run:  node scripts/token-benchmark.mjs
 *
 * The samples below are representative, hand-captured outputs (no live cluster
 * required). Structured samples mirror what the corresponding bash-mcp tool
 * returns for the same data — compact summaries, not the full upstream JSON.
 */

import { getEncoding } from "js-tiktoken";

const enc = getEncoding("o200k_base");
const count = (s) => enc.encode(s).length;

/** @type {{tool: string, raw: string, structured: string}[]} */
const SAMPLES = [
  {
    tool: "kubectl get pods -A",
    raw: `NAMESPACE     NAME                                READY   STATUS             RESTARTS      AGE
default       web-7c5b8d6c88-abc12                1/1     Running            0             3d4h
default       web-7c5b8d6c88-def34                1/1     Running            0             3d4h
default       worker-5d9f7b6c-ghi56               0/1     CrashLoopBackOff   12 (2m ago)   3d4h
kube-system   coredns-5d78c9869d-jkl78            1/1     Running            1 (5d ago)    9d
kube-system   kube-proxy-mno90                    1/1     Running            0             9d
payments      api-6f8c9d7b5-pqr12                 1/1     Running            0             18h
payments      migrate-xyz98                       0/1     Completed          0             18h`,
    structured: JSON.stringify({
      items: [
        {
          name: "web-7c5b8d6c88-abc12",
          namespace: "default",
          status: "Running",
          ready: "1/1",
          restarts: 0,
          age: "3d4h",
        },
        {
          name: "web-7c5b8d6c88-def34",
          namespace: "default",
          status: "Running",
          ready: "1/1",
          restarts: 0,
          age: "3d4h",
        },
        {
          name: "worker-5d9f7b6c-ghi56",
          namespace: "default",
          status: "CrashLoopBackOff",
          ready: "0/1",
          restarts: 12,
          age: "3d4h",
        },
        {
          name: "coredns-5d78c9869d-jkl78",
          namespace: "kube-system",
          status: "Running",
          ready: "1/1",
          restarts: 1,
          age: "9d",
        },
        {
          name: "kube-proxy-mno90",
          namespace: "kube-system",
          status: "Running",
          ready: "1/1",
          restarts: 0,
          age: "9d",
        },
        {
          name: "api-6f8c9d7b5-pqr12",
          namespace: "payments",
          status: "Running",
          ready: "1/1",
          restarts: 0,
          age: "18h",
        },
        {
          name: "migrate-xyz98",
          namespace: "payments",
          status: "Completed",
          ready: "0/1",
          restarts: 0,
          age: "18h",
        },
      ],
      count: 7,
      resource: "pods",
    }),
  },
  {
    tool: "kubectl describe pod (→ kube_diagnose_pod)",
    raw: `Name:             worker-5d9f7b6c-ghi56
Namespace:        default
Priority:         0
Service Account:  default
Node:             node-3/10.0.1.23
Start Time:       Mon, 26 May 2026 09:14:02 +0000
Labels:           app=worker
                  pod-template-hash=5d9f7b6c
Status:           Running
IP:               10.244.2.17
Controlled By:    ReplicaSet/worker-5d9f7b6c
Containers:
  worker:
    Container ID:   containerd://a1b2c3
    Image:          registry.example.com/worker:1.4.2
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Mon, 26 May 2026 09:40:11 +0000
      Finished:     Mon, 26 May 2026 09:40:12 +0000
    Ready:          False
    Restart Count:  12
Events:
  Type     Reason     Age                   From     Message
  ----     ------     ----                  ----     -------
  Warning  BackOff    2m (x140 over 30m)    kubelet  Back-off restarting failed container worker`,
    structured: JSON.stringify({
      status: "CrashLoopBackOff",
      likelyCauses: [
        "Container worker is crash-looping (12 restarts); last exit code 1 (application error).",
        "Check application logs for the failing container.",
      ],
      suggestedNextCommands: [
        "kube_logs(pod='worker-5d9f7b6c-ghi56', namespace='default', container='worker')",
      ],
      evidence: [
        "Restart Count: 12",
        "Last State: Terminated, Reason: Error, Exit Code: 1",
        "BackOff x140 over 30m",
      ],
    }),
  },
  {
    tool: "kubectl logs (ERROR filter)",
    raw: `2026-05-31T09:40:11.001Z INFO  starting worker v1.4.2
2026-05-31T09:40:11.114Z INFO  connecting to postgres at db:5432
2026-05-31T09:40:11.430Z WARN  retrying connection (attempt 1)
2026-05-31T09:40:12.002Z ERROR could not connect to database: connection refused
2026-05-31T09:40:12.003Z ERROR shutting down after fatal error
2026-05-31T09:40:12.004Z INFO  flushed metrics`,
    structured: JSON.stringify({
      lines: [
        {
          timestamp: "2026-05-31T09:40:12.002Z",
          message: "ERROR could not connect to database: connection refused",
        },
        {
          timestamp: "2026-05-31T09:40:12.003Z",
          message: "ERROR shutting down after fatal error",
        },
      ],
      count: 2,
      pod: "worker-5d9f7b6c-ghi56",
    }),
  },
  {
    tool: "terraform plan",
    raw: `Terraform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  + create
  ~ update in-place
  - destroy

Terraform will perform the following actions:

  # aws_instance.web will be updated in-place
  ~ resource "aws_instance" "web" {
        id            = "i-0abc123"
      ~ instance_type = "t3.small" -> "t3.medium"
        tags          = {
            "Name" = "web"
        }
    }

  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "app-logs-prod"
      + arn    = (known after apply)
    }

  # aws_security_group.old will be destroyed
  - resource "aws_security_group" "old" {
      - id   = "sg-0def456" -> null
      - name = "legacy" -> null
    }

Plan: 1 to add, 1 to change, 1 to destroy.`,
    structured: JSON.stringify({
      add: 1,
      change: 1,
      destroy: 1,
      changes: [
        { address: "aws_instance.web", action: "update" },
        { address: "aws_s3_bucket.logs", action: "create" },
        { address: "aws_security_group.old", action: "delete" },
      ],
      noChanges: false,
    }),
  },
  {
    tool: "helm list -A",
    raw: `NAME       NAMESPACE   REVISION   UPDATED                                 STATUS     CHART            APP VERSION
api        payments    7          2026-05-30 22:11:04.12 +0000 UTC        deployed   api-2.3.1        1.4.2
web        default     3          2026-05-28 10:02:55.91 +0000 UTC        deployed   web-1.8.0        2.0.0
cache      default     1          2026-05-12 08:44:10.55 +0000 UTC        failed     redis-17.4.0     7.0.5`,
    structured: JSON.stringify({
      releases: [
        {
          name: "api",
          namespace: "payments",
          revision: 7,
          status: "deployed",
          chart: "api-2.3.1",
          appVersion: "1.4.2",
        },
        {
          name: "web",
          namespace: "default",
          revision: 3,
          status: "deployed",
          chart: "web-1.8.0",
          appVersion: "2.0.0",
        },
        {
          name: "cache",
          namespace: "default",
          revision: 1,
          status: "failed",
          chart: "redis-17.4.0",
          appVersion: "7.0.5",
        },
      ],
      count: 3,
    }),
  },
  {
    tool: "argocd app list",
    raw: `NAME      CLUSTER                         NAMESPACE   PROJECT   STATUS     HEALTH      SYNCPOLICY   CONDITIONS   REPO                              PATH        TARGET
api       https://kubernetes.default.svc  payments    prod      Synced     Healthy     Auto         <none>       git@github.com:org/infra.git      apps/api    main
web       https://kubernetes.default.svc  default     prod      OutOfSync  Degraded    Auto         <none>       git@github.com:org/infra.git      apps/web    main
cache     https://kubernetes.default.svc  default     prod      Synced     Healthy     Manual       <none>       git@github.com:org/infra.git      apps/cache  main`,
    structured: JSON.stringify({
      apps: [
        {
          name: "api",
          project: "prod",
          syncStatus: "Synced",
          healthStatus: "Healthy",
          namespace: "payments",
        },
        {
          name: "web",
          project: "prod",
          syncStatus: "OutOfSync",
          healthStatus: "Degraded",
          namespace: "default",
        },
        {
          name: "cache",
          project: "prod",
          syncStatus: "Synced",
          healthStatus: "Healthy",
          namespace: "default",
        },
      ],
      count: 3,
      summary: { synced: 2, outOfSync: 1, healthy: 2, degraded: 1 },
    }),
  },
  {
    tool: "git diff (→ git_diff)",
    raw: `diff --git a/src/auth.ts b/src/auth.ts
index 3f1a2b4..9c8d7e6 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,7 +10,9 @@ export function verify(token: string) {
-  const payload = decode(token);
-  return payload.sub;
+  const payload = decode(token);
+  if (!payload) throw new Error("invalid token");
+  return payload.sub;
 }
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
-# old title
+# new title`,
    structured: JSON.stringify({
      files: [
        { file: "src/auth.ts", insertions: 3, deletions: 2 },
        { file: "README.md", insertions: 1, deletions: 1 },
      ],
      totalInsertions: 4,
      totalDeletions: 3,
      fileCount: 2,
    }),
  },
];

const rows = SAMPLES.map(({ tool, raw, structured }) => {
  const rawT = count(raw);
  const strT = count(structured);
  const reduction = ((rawT - strT) / rawT) * 100;
  return { tool, rawT, strT, reduction };
});

const totalRaw = rows.reduce((s, r) => s + r.rawT, 0);
const totalStr = rows.reduce((s, r) => s + r.strT, 0);
const totalReduction = ((totalRaw - totalStr) / totalRaw) * 100;

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

console.log(
  `Tokenizer: o200k_base (GPT-4o) — proxy for Claude; relative reduction is the headline.\n`,
);
console.log(
  `${pad("Command", 42)} ${padl("raw", 6)} ${padl("struct", 7)} ${padl("saved", 7)}`,
);
console.log("-".repeat(66));
for (const r of rows) {
  console.log(
    `${pad(r.tool, 42)} ${padl(r.rawT, 6)} ${padl(r.strT, 7)} ${padl(`${r.reduction.toFixed(0)}%`, 7)}`,
  );
}
console.log("-".repeat(66));
console.log(
  `${pad("TOTAL", 42)} ${padl(totalRaw, 6)} ${padl(totalStr, 7)} ${padl(`${totalReduction.toFixed(0)}%`, 7)}`,
);
