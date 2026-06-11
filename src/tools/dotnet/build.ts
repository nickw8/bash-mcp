/**
 * dotnet_build tool — structured MSBuild diagnostics.
 *
 * Wraps `dotnet build` and parses the output into typed diagnostics with file,
 * line, column, error code, and message. Runs with quiet verbosity and
 * suppressed logger noise to minimize raw output before parsing.
 *
 * Warnings are omitted by default — they're noise next to errors and flood
 * green warning-heavy builds. Pass includeWarnings:true (or detailLevel:'full')
 * to include them. The diagnostic list is also capped per the output budget so a
 * large error cascade can't blow the token budget.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import type { Diagnostic } from "#parsers";
import { err } from "#response";
import { defineTool } from "#tool";
import {
  diagnosticInputSchema,
  diagnosticsResponse,
} from "../../parsers/diagnostics-response.js";
import {
  applyBudget,
  countBySeverity,
  diagnosticSchema,
} from "../../parsers/schemas.js";
import { detectSolution } from "./detect.js";
import { parseMSBuildOutput } from "./parsers/msbuild.js";

/**
 * Gate warnings and cap the diagnostic list for dotnet_build.
 *
 * Warnings are dropped unless `includeWarnings` is set or `detailLevel` is
 * `"full"`; the surviving list is then capped by the output budget
 * (`detailLevel`/`maxItems`). Pure so the gate+cap policy is unit-testable
 * without invoking `dotnet`.
 */
export function selectBuildDiagnostics(
  all: Diagnostic[],
  opts: {
    includeWarnings?: boolean;
    detailLevel?: "summary" | "normal" | "full";
    maxItems?: number;
  },
): {
  diagnostics: Diagnostic[];
  truncated: boolean;
  total: number;
  showWarnings: boolean;
} {
  const showWarnings =
    Boolean(opts.includeWarnings) || opts.detailLevel === "full";
  const gated = showWarnings ? all : all.filter((d) => d.severity === "error");
  const { items, truncated, total } = applyBudget(gated, {
    detailLevel: opts.detailLevel,
    maxItems: opts.maxItems,
  });
  return { diagnostics: items, truncated, total, showWarnings };
}

/** Register the dotnet_build tool for structured build diagnostics. */
export function registerDotnetBuildTool(server: McpServer) {
  defineTool(
    server,
    "dotnet_build",
    {
      title: "Build (structured)",
      description:
        "Run dotnet build and return structured diagnostics with file, line, column, message, and error code. " +
        "Much more compact than raw MSBuild output. " +
        "Warnings are omitted by default; pass includeWarnings:true (or detailLevel:'full') to include them.",
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        project: z
          .string()
          .optional()
          .describe(
            "Path to .csproj or .sln file (default: auto-detected in cwd)",
          ),
        configuration: z
          .string()
          .optional()
          .describe("Build configuration (e.g. Debug, Release)"),
        includeWarnings: z
          .boolean()
          .optional()
          .describe(
            "Include warnings in the response (default: errors only, even on a successful build)",
          ),
        ...diagnosticInputSchema,
      },
      outputSchema: {
        diagnostics: z.array(diagnosticSchema),
        exitCode: z.number(),
        errorCount: z.number(),
        warningCount: z.number(),
        summary: z.string(),
      },
    },
    async ({
      cwd,
      project,
      configuration,
      includeWarnings,
      format,
      fields,
      detailLevel,
      maxItems,
    }) => {
      const args = ["build"];

      const target = project ?? detectSolution(cwd);
      if (target) args.push(target);

      if (configuration) args.push("-c", configuration);

      // Suppress MSBuild noise: no summary banner, no property/item lists
      args.push(
        "-v:quiet",
        "-consoleloggerparameters:NoSummary;NoItemAndPropertyList",
      );

      const result = await exec("dotnet", args, {
        cwd,
        timeout: TIMEOUT.BUILD,
      });

      const output = `${result.stdout}\n${result.stderr}`;
      const allDiagnostics = parseMSBuildOutput(output);

      // Counts reflect the full parse; the response list is gated + capped below.
      const { errorCount, warningCount } = countBySeverity(allDiagnostics);

      const { diagnostics, truncated, total, showWarnings } =
        selectBuildDiagnostics(allDiagnostics, {
          includeWarnings,
          detailLevel,
          maxItems,
        });

      const status = result.exitCode === 0 ? "succeeded" : "failed";
      const warnNote =
        warningCount > 0 && !showWarnings
          ? " (warnings omitted; includeWarnings:true to show)"
          : "";
      const summary = `Build ${status}. ${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""}${warnNote}.`;

      const structured = {
        diagnostics,
        exitCode: result.exitCode,
        errorCount,
        warningCount,
        summary,
      };

      if (result.exitCode !== 0 && errorCount === 0) {
        return err(output.slice(0, 500), structured);
      }

      const meta: Record<string, unknown> = { errorCount, warningCount };
      if (truncated) {
        meta.shown = diagnostics.length;
        meta.total = total;
      }

      return diagnosticsResponse(structured, diagnostics, {
        format,
        fields,
        meta,
      });
    },
  );
}
