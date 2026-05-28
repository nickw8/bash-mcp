#!/usr/bin/env node

/**
 * Prepublish guard for bash-mcp.
 *
 * Runs as part of `prepublishOnly` to verify the bundled dist/index.js is a
 * valid shippable artifact before npm allows the publish to proceed.
 *
 * Checks:
 *   1. dist/index.js exists
 *   2. First line is the Node shebang (so the bin entry is executable)
 *   3. Bundle size is within expected bounds (> 1KB, < 5MB)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(__dirname, "..", "dist", "index.js");

function fail(message) {
  console.error(`prepublish: ${message}`);
  process.exit(1);
}

if (!existsSync(distPath)) {
  fail(`missing ${distPath}. Run \`npm run build\` before publish.`);
}

const content = readFileSync(distPath, "utf8");

const firstLine = content.split("\n", 1)[0];
if (firstLine !== "#!/usr/bin/env node") {
  fail(
    `first line of dist/index.js is not a node shebang — got: ${JSON.stringify(firstLine)}`,
  );
}

const sizeBytes = statSync(distPath).size;
const sizeKB = (sizeBytes / 1024).toFixed(1);
if (sizeBytes < 1024) {
  fail(
    `bundle is suspiciously small (${sizeBytes} bytes) — likely empty or broken.`,
  );
}
if (sizeBytes > 5 * 1024 * 1024) {
  fail(
    `bundle is too large (${sizeKB} KB) — something unexpected got bundled.`,
  );
}

console.log(`prepublish: bundle looks good (${sizeKB} KB, shebang present).`);
