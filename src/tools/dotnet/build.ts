/**
 * dotnet_build tool — structured MSBuild diagnostics.
 *
 * Wraps `dotnet build` and parses the output into typed diagnostics with file,
 * line, column, error code, and message. Runs with quiet verbosity and
 * suppressed logger noise to minimize raw output before parsing.
 *
 * When the build fails (errors present), warnings are omitted from the
 * response — they're noise when the developer needs to focus on errors.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { countBySeverity, diagnosticSchema } from "../../parsers/schemas.js";
import { detectSolution } from "./detect.js";
import { parseMSBuildOutput } from "./parsers/msbuild.js";

/** Register the dotnet_build tool for structured build diagnostics. */
export function registerDotnetBuildTool(server: McpServer) {
  defineTool(
    server,
    "dotnet_build",
    {
      title: "Build (structured)",
      description:
        "Run dotnet build and return structured diagnostics with file, line, column, message, and error code. " +
        "Much more compact than raw MSBuild output.",
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
      },
      outputSchema: {
        diagnostics: z.array(diagnosticSchema),
        exitCode: z.number(),
        errorCount: z.number(),
        warningCount: z.number(),
        summary: z.string(),
      },
    },
    async ({ cwd, project, configuration }) => {
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

      const { errorCount, warningCount } = countBySeverity(allDiagnostics);

      // When errors exist, omit warnings — they're noise when the build is broken
      const diagnostics =
        errorCount > 0
          ? allDiagnostics.filter((d) => d.severity === "error")
          : allDiagnostics;

      const status = result.exitCode === 0 ? "succeeded" : "failed";
      const warnNote =
        errorCount > 0 && warningCount > 0 ? " (warnings omitted)" : "";
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

      return ok(structured);
    },
  );
}
