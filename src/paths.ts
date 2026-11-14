/**
 * Shared path-resolution helper for project-scoped routes.
 *
 * Project-scoped resources are addressed
 * as `/@<projectSlug>/...` against the org host. The slug is the only project addressing form.
 *
 * Caller is expected to validate that the config carries a `projectSlug`
 * at construction time (see `validateGateConfig`).
 */

import type { GateConfig } from "./mode.ts";

/** Return the project-scoped path root for the supplied config, e.g.
 *  `/@partner-console-staging`. */
export function resolveProjectPathRoot(config: GateConfig): string {
  return `/@${config.projectSlug}`;
}
