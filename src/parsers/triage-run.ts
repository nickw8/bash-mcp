/**
 * Triage run: one Probe read as a Triage. The module every Diagnostic tool
 * hands its CLI call to, so the ADR-0005 decision is made in one place:
 *
 *   - the probe never ran (`isUnrunnable`)        → `err`
 *   - the probe ran and failed, or gave no data   → Unknown triage
 *   - the probe answered                          → the tool's classifier
 *
 * The tool keeps the binary, args and timeout (inside the `probe` thunk), the
 * classification, and its own empty fields; this owns only the decision.
 */
import type { ExecJsonResult } from "#exec";
import { err, ok } from "#response";
import { isUnrunnable, unknownTriage } from "./schemas.js";

export interface TriageRunOpts<
  T,
  E extends Record<string, unknown>,
  P extends Record<string, unknown>,
> {
  /** The one CLI call, e.g. `() => execJson<T>("kubectl", args, { timeout })`. */
  probe: () => Promise<ExecJsonResult<T>>;
  /** The tool's non-Triage fields at their empty values; spread onto the error payload and the Unknown answer. */
  empty: E;
  /** What failed, as the Unknown evidence prefix: `"kubectl get pod failed"` → `kubectl get pod failed: <why>`. */
  failure: string;
  /** Commands to suggest when the probe ran and failed. */
  suggestedNextCommands?: string[];
  /** The kube context the probe ran against; bound onto every suggestion so a follow-up hits the same cluster. */
  context?: string;
  /** Turn the probe's data into the tool's whole payload. Not called on failure. */
  classify: (data: T) => P | Promise<P>;
}

/** Run a Probe and answer with a Triage: the classifier's output, an Unknown triage, or an error. */
export async function triageRun<
  T,
  E extends Record<string, unknown>,
  P extends Record<string, unknown>,
>(o: TriageRunOpts<T, E, P>) {
  const res = await o.probe();
  if (res.error !== null && isUnrunnable(res.detail)) {
    return err(res.error, o.empty, res.detail);
  }
  if (res.error !== null || res.data === null) {
    const why = res.error ?? "no data";
    return ok({
      ...o.empty,
      ...unknownTriage(
        `${o.failure}: ${why}`,
        bindContext(o.suggestedNextCommands, o.context),
      ),
    });
  }
  const payload = await o.classify(res.data);
  const next = payload.suggestedNextCommands;
  return ok(
    Array.isArray(next)
      ? { ...payload, suggestedNextCommands: bindContext(next, o.context) }
      : payload,
  );
}

/** Append `context=<ctx>` to each command; unchanged when no context was given. */
function bindContext(commands: string[] | undefined, context?: string) {
  return context ? commands?.map((c) => `${c} context=${context}`) : commands;
}
