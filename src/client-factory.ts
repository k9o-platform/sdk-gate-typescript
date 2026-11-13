/**
 * `createGateClient(config)` — per-instance Gate SDK factory.
 *
 * Returns a self-contained `GateClient` that does not depend on the
 * module-level `configureGate()` singleton. Multiple clients can coexist
 * in the same process, each scoped to its own project + baseUrl + mode —
 * useful for multi-tenant Backends-For-Frontends (one client per
 * incoming request's resolved tenant) or for apps that maintain both a
 * Standalone and Native binding against the same SDK instance.
 *
 * Supply `projectSlug` for
 * `/@<slug>/gate/...` routing. The slug is the only project addressing form.
 *
 * Example:
 *   const client = createGateClient({
 *     baseUrl: 'https://formelo.api.k9o.io', // or: orgSlug: 'formelo'
 *     projectSlug: 'member-portal',
 *     mode: 'native',
 *   });
 *   await client.signIn({ email, password });
 */

import { makeGateNamespace } from "./gate.ts";
import { resolveGateConfig, type GateClientConfig } from "./mode.ts";

/** Shape of the per-instance client returned by `createGateClient`. */
export type GateClient = ReturnType<typeof makeGateNamespace>;

/** Construct a Gate client bound to the supplied config. The config is
 *  validated up-front and stored on the instance; subsequent calls do not
 *  re-read process-level state. Throws `TypeError` on invalid config. */
export function createGateClient(config: GateClientConfig): GateClient {
  const frozen = resolveGateConfig(config);
  return makeGateNamespace(() => frozen);
}
