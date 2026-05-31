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
 * For EXACT Claude counts, set USE_CLAUDE_TOKENIZER=1 with a direct Anthropic
 * API key in ANTHROPIC_API_KEY — the script then calls the count_tokens API
 * instead of the proxy:  USE_CLAUDE_TOKENIZER=1 node scripts/token-benchmark.mjs
 *
 * The samples below are representative, hand-captured outputs (no live cluster
 * required) — a SUBSET of the wrappers, not all of them. Structured samples
 * mirror what the corresponding bash-mcp tool returns for the same data —
 * compact summaries, not the full upstream JSON.
 *
 * Three aggregates are reported: a token-weighted total (dominated by the few
 * large samples), the median per-command reduction (robust central tendency),
 * and a frequency-weighted total using the illustrative WEIGHTS below (a
 * realistic triage/dev session: mostly read/diff/log/diagnose calls). A scaling
 * section measures how the flat-list gap behaves as row count grows.
 */

import { getEncoding } from "js-tiktoken";

const enc = getEncoding("o200k_base");
const proxyCount = (s) => enc.encode(s).length;

// Optional: real Claude token counts via the Anthropic count_tokens API. The
// API wraps the text in a user message, so counts carry a small constant
// per-call overhead — the relative reduction stays the robust figure.
const USE_CLAUDE = process.env.USE_CLAUDE_TOKENIZER === "1";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function claudeCount(text) {
  const res = await fetch(
    "https://api.anthropic.com/v1/messages/count_tokens",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        messages: [{ role: "user", content: text || " " }],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.input_tokens;
}

const count = USE_CLAUDE ? claudeCount : async (s) => proxyCount(s);

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
  {
    tool: "ls -lh (→ ls)",
    raw: `total 24K
-rw-r--r-- 1 nick nick 1.6K 2026-05-31 12:00 package.json
-rw-r--r-- 1 nick nick 8.2K 2026-05-30 09:14 README.md
drwxr-xr-x 5 nick nick 4.0K 2026-05-31 14:00 src
drwxr-xr-x 2 nick nick 4.0K 2026-05-31 13:54 fixtures
-rw-r--r-- 1 nick nick  220 2026-05-12 08:44 tsconfig.json`,
    // ls defaults to TSV output (okList) — its real, compact default representation.
    structured: `total\t5
path\t.
---
name\ttype\tsize\tpermissions\tmodified
package.json\tfile\t1638\t-rw-r--r--\t2026-05-31
README.md\tfile\t8396\t-rw-r--r--\t2026-05-30
src\tdir\t4096\tdrwxr-xr-x\t2026-05-31
fixtures\tdir\t4096\tdrwxr-xr-x\t2026-05-31
tsconfig.json\tfile\t220\t-rw-r--r--\t2026-05-12`,
  },
  {
    tool: "tree (→ tree)",
    raw: `src
├── index.ts
├── exec.ts
├── tools
│   ├── git
│   │   ├── status.ts
│   │   └── log.ts
│   └── kubernetes
│       └── kubernetes.ts
└── parsers
    └── types.ts

5 directories, 6 files`,
    // tree defaults to bare output (okList) — paths only, dirs end with "/".
    structured: `dirs\t5
files\t6
---
src/index.ts
src/exec.ts
src/tools/
src/tools/git/
src/tools/git/status.ts
src/tools/git/log.ts
src/tools/kubernetes/
src/tools/kubernetes/kubernetes.ts
src/parsers/
src/parsers/types.ts`,
  },
  {
    tool: "du (→ du)",
    raw: `4.0K\t./src/parsers
24K\t./src/tools
40K\t./src
8.0K\t./fixtures
60K\t.`,
    // du defaults to TSV (okList); derived sizeHuman omitted from the text view.
    structured: `path\tsizeBytes
./src/parsers\t4096
./src/tools\t24576
./src\t40960
./fixtures\t8192
.\t61440`,
  },
  {
    tool: "ripgrep (→ rg)",
    raw: `src/auth.ts
12:  if (!token) throw new Error("missing token");
45:  const token = req.headers.authorization;

src/server.ts
88:  validateToken(token);`,
    // rg defaults to TSV output (okList) — its real, compact default representation.
    structured: `fileCount\t2
matchCount\t3
truncated\tfalse
---
file\tline\ttext
src/auth.ts\t12\t  if (!token) throw new Error("missing token");
src/auth.ts\t45\t  const token = req.headers.authorization;
src/server.ts\t88\t  validateToken(token);`,
  },
  {
    tool: "cat full file (→ outline)",
    raw: `import { z } from "zod";
import { db } from "./db";

export interface User {
  id: string;
  email: string;
}

export class UserService {
  constructor(private cache: Cache) {}

  async getUser(id: string): Promise<User | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    if (!row) return null;
    const user = { id: row.id, email: row.email };
    this.cache.set(id, user);
    return user;
  }

  async createUser(email: string): Promise<User> {
    const id = crypto.randomUUID();
    await db.insert("users", { id, email });
    return { id, email };
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete("users", id);
    this.cache.evict(id);
  }
}

export function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+$/.test(email);
}`,
    structured: JSON.stringify({
      path: "src/user-service.ts",
      language: "typescript",
      totalLines: 38,
      symbols: 6,
      outline: [
        'import { z } from "zod"',
        'import { db } from "./db"',
        "interface User",
        "class UserService",
        "  getUser(id: string): Promise<User | null>",
        "  createUser(email: string): Promise<User>",
        "  deleteUser(id: string): Promise<void>",
        "function validateEmail(email: string): boolean",
      ].join("\n"),
    }),
  },
  {
    tool: "git status (→ git_status)",
    raw: `On branch main
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
        modified:   src/auth.ts

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
        modified:   README.md

Untracked files:
  (use "git add <file>..." to include in what will be committed)
        notes.txt`,
    structured: JSON.stringify({
      branch: "main",
      ahead: 2,
      behind: 0,
      staged: [{ file: "src/auth.ts", status: "modified" }],
      unstaged: [{ file: "README.md", status: "modified" }],
      untracked: ["notes.txt"],
      clean: false,
    }),
  },
  {
    tool: "git log (→ git_log)",
    raw: `commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 (HEAD -> main)
Author: Nick <nick@example.com>
Date:   Fri May 30 22:11:04 2026 +0000

    feat: add retry logic

commit 9f8e7d6c5b4a3210fedcba9876543210fedcba98
Author: Nick <nick@example.com>
Date:   Thu May 29 10:02:55 2026 +0000

    fix: handle null token`,
    // git_log defaults to TSV (okList); redundant full hash dropped from text.
    structured: `count\t2
---
shortHash\tauthor\tdate\tmessage
a1b2c3d\tNick\t2026-05-30T22:11:04+00:00\tfeat: add retry logic
9f8e7d6\tNick\t2026-05-29T10:02:55+00:00\tfix: handle null token`,
  },
  {
    tool: "git branch -v (→ git_branches)",
    raw: `* main                a1b2c3d feat: add retry logic
  feature/auth        9f8e7d6 wip: oauth flow
  bugfix/null-token   5d4c3b2 fix: handle null token`,
    // git_branches defaults to TSV (okList); all-false remote column omitted.
    structured: `current\tmain
---
name\tcurrent\tlastCommit
main\ttrue\ta1b2c3d feat: add retry logic
feature/auth\tfalse\t9f8e7d6 wip: oauth flow
bugfix/null-token\tfalse\t5d4c3b2 fix: handle null token`,
  },
  {
    tool: "kubectl config get-contexts (→ kube_contexts)",
    raw: `CURRENT   NAME      CLUSTER   AUTHINFO     NAMESPACE
*         prod      prod      prod-admin   payments
          staging   staging   stg-admin    default
          dev       dev       dev-admin    default`,
    // kube_contexts defaults to TSV (okList).
    structured: `current\tprod
---
name\tcluster\tnamespace\tcurrent
prod\tprod\tpayments\ttrue
staging\tstaging\tdefault\tfalse
dev\tdev\tdefault\tfalse`,
  },
  {
    tool: "kubectl get events (→ kube_events_summary)",
    raw: `LAST SEEN   TYPE      REASON             OBJECT                       MESSAGE
2m          Warning   BackOff            pod/worker-5d9f7b6c-ghi56    Back-off restarting failed container worker
5m          Warning   FailedScheduling   pod/api-6f8c9d7b5-new        0/3 nodes available: insufficient memory
8m          Normal    Scheduled          pod/web-7c5b8d6c88-abc12     Successfully assigned default/web to node-1
10m         Warning   Unhealthy          pod/web-7c5b8d6c88-def34     Readiness probe failed: HTTP probe returned 503`,
    structured: JSON.stringify({
      status: "3 warning events",
      likelyCauses: [
        "worker-5d9f7b6c-ghi56: container crash-looping (BackOff)",
        "api-6f8c9d7b5-new: unschedulable — insufficient memory on all nodes",
        "web-7c5b8d6c88-def34: readiness probe failing (HTTP 503)",
      ],
      suggestedNextCommands: ["kube_diagnose_pod(pod='worker-5d9f7b6c-ghi56')"],
      evidence: [
        "Warning BackOff x? on worker",
        "Warning FailedScheduling on api",
        "Warning Unhealthy on web",
      ],
    }),
  },
  {
    tool: "terraform state list (→ tf_state_list)",
    raw: `module.network.aws_vpc.main
module.network.aws_subnet.public[0]
module.network.aws_subnet.public[1]
aws_instance.web
aws_s3_bucket.logs`,
    // tf_state_list defaults to bare (okList): addresses only, byType in meta.
    structured: `count\t5
byType\t{"aws_vpc":1,"aws_subnet":2,"aws_instance":1,"aws_s3_bucket":1}
---
module.network.aws_vpc.main
module.network.aws_subnet.public[0]
module.network.aws_subnet.public[1]
aws_instance.web
aws_s3_bucket.logs`,
  },
  {
    tool: "terraform output (→ tf_outputs)",
    raw: `vpc_id = "vpc-0abc123"
public_subnets = [
  "subnet-01",
  "subnet-02",
]
db_endpoint = "app-db.xyz.rds.amazonaws.com:5432"
api_key = <sensitive>`,
    // tf_outputs defaults to TSV (okList); verbose type column dropped from text.
    structured: `count\t4
---
name\tvalue\tsensitive
vpc_id\tvpc-0abc123\tfalse
public_subnets\t["subnet-01","subnet-02"]\tfalse
db_endpoint\tapp-db.xyz.rds.amazonaws.com:5432\tfalse
api_key\t\ttrue`,
  },
  {
    tool: "helm status (→ helm_status)",
    raw: `NAME: api
LAST DEPLOYED: Fri May 30 22:11:04 2026
NAMESPACE: payments
STATUS: deployed
REVISION: 7
TEST SUITE: None
NOTES:
1. Get the application URL by running these commands:
  export POD_NAME=$(kubectl get pods -n payments -l app=api -o jsonpath="{.items[0].metadata.name}")
  echo "Visit http://127.0.0.1:8080 to use your application"
  kubectl port-forward $POD_NAME 8080:80`,
    structured: JSON.stringify({
      name: "api",
      namespace: "payments",
      revision: 7,
      status: "deployed",
      description: "Upgrade complete",
      lastDeployed: "2026-05-30T22:11:04Z",
      notes: "1. Get the application URL by running these commands: ...",
    }),
  },
  {
    tool: "argocd app get (→ argo_app_detail)",
    raw: `Name:               web
Project:            prod
Server:             https://kubernetes.default.svc
Namespace:          default
URL:                https://argocd.example.com/applications/web
Repo:               git@github.com:org/infra.git
Target:             main
Path:               apps/web
SyncWindow:         Sync Allowed
Sync Policy:        Automated
Sync Status:        OutOfSync from main (a1b2c3d)
Health Status:      Degraded

GROUP  KIND        NAMESPACE  NAME  STATUS     HEALTH    HOOK  MESSAGE
       Service     default    web   Synced     Healthy
apps   Deployment  default    web   OutOfSync  Degraded        replica set "web-7c5" failed progressing`,
    structured: JSON.stringify({
      name: "web",
      project: "prod",
      syncStatus: "OutOfSync",
      healthStatus: "Degraded",
      revision: "a1b2c3d",
      message: 'replica set "web-7c5" failed progressing',
      resources: [
        {
          kind: "Service",
          name: "web",
          namespace: "default",
          status: "Synced",
          health: "Healthy",
        },
        {
          kind: "Deployment",
          name: "web",
          namespace: "default",
          status: "OutOfSync",
          health: "Degraded",
        },
      ],
      conditions: [],
    }),
  },
  {
    tool: "tsc --noEmit (→ npm_typecheck)",
    raw: `src/auth.ts:12:9 - error TS2304: Cannot find name 'tokenn'.

12   return tokenn;
             ~~~~~~

src/server.ts:45:3 - error TS2554: Expected 2 arguments, but got 1.

45   validate(token);
     ~~~~~~~~~~~~~~~~

Found 2 errors in 2 files.`,
    structured: JSON.stringify({
      errors: [
        {
          file: "src/auth.ts",
          line: 12,
          column: 9,
          severity: "error",
          rule: "TS2304",
          message: "Cannot find name 'tokenn'.",
        },
        {
          file: "src/server.ts",
          line: 45,
          column: 3,
          severity: "error",
          rule: "TS2554",
          message: "Expected 2 arguments, but got 1.",
        },
      ],
      errorCount: 2,
      success: false,
    }),
  },
  {
    tool: "pytest (→ python_test)",
    raw: `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.0.0, pluggy-1.4.0
rootdir: /proj
collected 14 items

tests/test_auth.py ....F....                                            [ 64%]
tests/test_db.py .....                                                  [100%]

=================================== FAILURES ===================================
______________________________ test_expired_token _____________________________

    def test_expired_token():
>       assert verify(expired) is None
E       AssertionError: assert <User id=1> is None

tests/test_auth.py:42: AssertionError
=========================== short test summary info ============================
FAILED tests/test_auth.py::test_expired_token - AssertionError: assert <User...
========================= 1 failed, 13 passed in 1.23s =========================`,
    structured: JSON.stringify({
      total: 14,
      passed: 13,
      failed: 1,
      failures: [
        {
          name: "tests/test_auth.py::test_expired_token",
          message: "AssertionError: assert <User id=1> is None",
        },
      ],
    }),
  },
  {
    tool: "dotnet build (→ dotnet_build)",
    raw: `Microsoft (R) Build Engine version 17.8.0+abc for .NET
  Determining projects to restore...
  Restored /proj/App.csproj (in 412 ms).
  App -> /proj/bin/Debug/net8.0/App.dll
/proj/Services/UserService.cs(28,17): error CS0103: The name 'cach' does not exist in the current context [/proj/App.csproj]
/proj/Services/UserService.cs(40,9): warning CS0168: The variable 'ex' is declared but never used [/proj/App.csproj]

Build FAILED.

    1 Warning(s)
    1 Error(s)

Time Elapsed 00:00:03.45`,
    structured: JSON.stringify({
      errors: [
        {
          file: "/proj/Services/UserService.cs",
          line: 28,
          column: 17,
          severity: "error",
          rule: "CS0103",
          message: "The name 'cach' does not exist in the current context",
        },
        {
          file: "/proj/Services/UserService.cs",
          line: 40,
          column: 9,
          severity: "warning",
          rule: "CS0168",
          message: "The variable 'ex' is declared but never used",
        },
      ],
      errorCount: 1,
      warningCount: 1,
      success: false,
    }),
  },
  {
    tool: "which + version probes (→ check_environment)",
    raw: `$ which kubectl terraform helm jq node argocd
/usr/local/bin/kubectl
/usr/local/bin/terraform
/usr/local/bin/helm
/usr/bin/jq
/usr/local/bin/node
argocd not found
$ kubectl version --client -o json | jq -r .clientVersion.gitVersion
v1.31.2
$ terraform version
Terraform v1.9.5
$ helm version --short
v3.16.1
$ node --version
v20.18.0
$ kubectl config current-context
prod`,
    structured: JSON.stringify({
      node: { installed: true, version: "20.18.0" },
      kubectl: { installed: true, version: "1.31.2", context: "prod" },
      terraform: { installed: true, version: "1.9.5" },
      helm: { installed: true, version: "3.16.1" },
      jq: { installed: true, version: "1.7" },
      argocd: { installed: false },
    }),
  },
];

// Illustrative call frequency for a realistic triage/dev session — used only
// for the frequency-weighted aggregate. Read/diff/log/diagnose dominate; bulk
// infra listings are rare. Tools not listed default to weight 1.
const WEIGHTS = {
  "cat full file (→ outline)": 8,
  "ripgrep (→ rg)": 8,
  "ls -lh (→ ls)": 6,
  "git status (→ git_status)": 5,
  "git diff (→ git_diff)": 5,
  "kubectl get pods -A": 5,
  "kubectl logs (ERROR filter)": 4,
  "kubectl describe pod (→ kube_diagnose_pod)": 3,
  "git log (→ git_log)": 3,
  "tsc --noEmit (→ npm_typecheck)": 3,
  "helm list -A": 2,
  "helm status (→ helm_status)": 2,
  "argocd app list": 2,
  "argocd app get (→ argo_app_detail)": 2,
  "kubectl get events (→ kube_events_summary)": 2,
  "terraform plan": 2,
  "pytest (→ python_test)": 2,
  "tree (→ tree)": 2,
  "git branch -v (→ git_branches)": 2,
};

// Synthetic, homogeneous terraform state list of N resources — used by the
// scaling section to show how the flat-list gap behaves as rows grow. tf_state_list
// now defaults to BARE output (one address per line, byType in meta), so per-row
// cost equals the raw address and only the fixed meta block is overhead — the gap
// closes toward ~0% as the meta amortizes across rows.
const tfStateListRaw = (n) =>
  Array.from(
    { length: n },
    (_, i) => `module.network.aws_subnet.public[${i}]`,
  ).join("\n");

const tfStateListStructured = (n) =>
  `count\t${n}\nbyType\t${JSON.stringify({ aws_subnet: n })}\n---\n${tfStateListRaw(n)}`;

const rows = await Promise.all(
  SAMPLES.map(async ({ tool, raw, structured }) => {
    const [rawT, strT] = await Promise.all([count(raw), count(structured)]);
    const reduction = ((rawT - strT) / rawT) * 100;
    return { tool, rawT, strT, reduction, weight: WEIGHTS[tool] ?? 1 };
  }),
);

const totalRaw = rows.reduce((s, r) => s + r.rawT, 0);
const totalStr = rows.reduce((s, r) => s + r.strT, 0);
const totalReduction = ((totalRaw - totalStr) / totalRaw) * 100;

const sortedRed = rows.map((r) => r.reduction).sort((a, b) => a - b);
const mid = Math.floor(sortedRed.length / 2);
const medianReduction =
  sortedRed.length % 2 === 0
    ? (sortedRed[mid - 1] + sortedRed[mid]) / 2
    : sortedRed[mid];

const wRaw = rows.reduce((s, r) => s + r.rawT * r.weight, 0);
const wStr = rows.reduce((s, r) => s + r.strT * r.weight, 0);
const weightedReduction = ((wRaw - wStr) / wRaw) * 100;

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const pct = (n) => `${n.toFixed(0)}%`;

const label = USE_CLAUDE
  ? `Claude count_tokens (${CLAUDE_MODEL}) — exact Claude counts.`
  : "o200k_base (GPT-4o) — proxy for Claude; relative reduction is the headline.";
console.log(`Tokenizer: ${label}\n`);
console.log(
  `${pad("Command", 42)} ${padl("raw", 6)} ${padl("struct", 7)} ${padl("saved", 7)}`,
);
console.log("-".repeat(66));
for (const r of [...rows].sort((a, b) => b.reduction - a.reduction)) {
  console.log(
    `${pad(r.tool, 42)} ${padl(r.rawT, 6)} ${padl(r.strT, 7)} ${padl(pct(r.reduction), 7)}`,
  );
}
console.log("-".repeat(66));
console.log(
  `${pad("TOTAL (token-weighted)", 42)} ${padl(totalRaw, 6)} ${padl(totalStr, 7)} ${padl(pct(totalReduction), 7)}`,
);
console.log(
  `${pad("MEDIAN per-command reduction", 42)} ${padl(pct(medianReduction), 23)}`,
);
console.log(
  `${pad("FREQUENCY-weighted reduction", 42)} ${padl(pct(weightedReduction), 23)}`,
);

console.log(
  `\nScaling: homogeneous terraform state list (→ tf_state_list) at N rows`,
);
console.log(
  `${pad("N rows", 42)} ${padl("raw", 6)} ${padl("struct", 7)} ${padl("saved", 7)}`,
);
console.log("-".repeat(66));
for (const n of [5, 50, 200, 1000]) {
  const [r, s] = await Promise.all([
    count(tfStateListRaw(n)),
    count(tfStateListStructured(n)),
  ]);
  const red = ((r - s) / r) * 100;
  console.log(
    `${pad(String(n), 42)} ${padl(r, 6)} ${padl(s, 7)} ${padl(pct(red), 7)}`,
  );
}
