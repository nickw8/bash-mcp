/**
 * Pure ArgoCD application health summarization.
 *
 * Turns `argocd app get -o json` into a degraded/synced health answer with the
 * unhealthy resources and conditions as evidence — so an agent gets the "is
 * this app OK and if not, why" picture in one call. Pure, fixture-tested.
 */

import type { Triage } from "#parsers";
import type { ArgoApp } from "./payload.js";

/** Summarize an app's health: the shared triage envelope plus argo-specific fields. */
export function summarizeAppHealth(
  app: ArgoApp,
): Triage & { name: string; syncStatus: string; healthy: boolean } {
  const health = app.status?.health?.status ?? "Unknown";
  const sync = app.status?.sync?.status ?? "Unknown";
  const healthy = health === "Healthy" && sync === "Synced";
  const likelyCauses: string[] = [];
  const suggestedNextCommands: string[] = [];
  const evidence: string[] = [];

  if (sync === "OutOfSync") {
    likelyCauses.push(
      "Application is OutOfSync — live state differs from the desired manifests.",
    );
    suggestedNextCommands.push("argo_app_diff");
  }
  if (health === "Degraded") {
    likelyCauses.push(
      "Application is Degraded — one or more resources are unhealthy.",
    );
  } else if (health === "Progressing") {
    likelyCauses.push(
      "Application is still Progressing — a rollout is in flight.",
    );
  } else if (health === "Missing") {
    likelyCauses.push(
      "Resources are Missing — they may not have been created yet.",
    );
  }

  for (const r of app.status?.resources ?? []) {
    const rh = r.health?.status;
    const unhealthy =
      (rh && rh !== "Healthy") || (r.status && r.status !== "Synced");
    if (unhealthy) {
      const parts = [`${r.kind ?? "?"}/${r.name ?? "?"}`];
      if (r.status) parts.push(r.status);
      if (rh) parts.push(rh);
      if (r.health?.message) parts.push(`(${r.health.message})`);
      evidence.push(parts.join(" "));
    }
  }

  for (const c of app.status?.conditions ?? []) {
    if (c.type) evidence.push(`${c.type}: ${c.message ?? ""}`.trim());
  }

  const opMsg = app.status?.operationState?.message;
  if (opMsg && !healthy) likelyCauses.push(opMsg);

  return {
    name: app.metadata?.name ?? "",
    status: health,
    syncStatus: sync,
    healthy,
    likelyCauses,
    suggestedNextCommands,
    evidence,
  };
}
