/**
 * `gate.magicLinkRedirects` sub-namespace — the per-project magic-link
 * redirect-URL allowlist, PROJECT_ADMIN+ managed. `list()`/`add()`/`remove()`, mirroring the
 * `gate.idpProviders.*` sub-namespace convention (gate-admin surface,
 * not the end-user-facing `passwordless.*` send/verify flow).
 *
 * Wraps the live gateway routes (`services/gateway/src/routes/
 * gate-magic-link-redirects.ts`):
 *
 *   GET    /@<projectSlug>/gate/magic-link-redirects
 *   POST   /@<projectSlug>/gate/magic-link-redirects        { redirectUrl, isDefault? }
 *   PATCH  /@<projectSlug>/gate/magic-link-redirects/:id    { isDefault: true }
 *   DELETE /@<projectSlug>/gate/magic-link-redirects/:id
 *
 * One deliberate deviation from the shorthand in the original blessing
 * relay ("remove(redirectUrl)"): the shipped route deletes by the
 * redirect row's `id`, not by re-presenting its `redirectUrl` value —
 * verified directly against the route, not assumed from the relay's
 * informal shape sketch. `remove(id)` matches what the gateway actually
 * does; a `redirectUrl`-keyed removal would need an extra `list()`
 * round-trip to resolve the id first, which the SDK should not do
 * silently on the caller's behalf.
 *
 * Auth: operator JWT with PROJECT_ADMIN+ (or ORG_ADMIN/ORG_OWNER) role —
 * the gateway rejects end-user JWTs and lower-role operators alike
 * (K9O_RBAC_DENY). The allowlist is a security control: registering a
 * redirect target is an admin act, same posture as `idpProviders.*`.
 */

import { getGateConfig, type GateConfig } from "./mode.ts";
import { requestWith } from "./client.ts";
import { resolveProjectPathRoot } from "./paths.ts";
import type { Envelope } from "./types.ts";

/** A single allowlisted magic-link redirect target. */
export type MagicLinkRedirect = {
  id: string;
  redirectUrl: string;
  isDefault: boolean;
  createdAt: string;
};

export type AddMagicLinkRedirectInput = {
  redirectUrl: string;
  /**
   * When true, this target becomes the default the gateway falls back to
   * when a `requestMagicLink` call doesn't specify one. The gateway
   * atomically demotes any previously-default entry — never two
   * simultaneous defaults.
   */
  isDefault?: boolean;
};

export type RemoveMagicLinkRedirectResult = { removed: true; id: string };

function magicLinkRedirectsPath(config: GateConfig, id?: string): string {
  const root = `${resolveProjectPathRoot(config)}/gate/magic-link-redirects`;
  return id !== undefined ? `${root}/${id}` : root;
}

/** Factory — produces a `magicLinkRedirects` namespace bound to the
 *  supplied config getter. Used by both the `gate` singleton +
 *  `createGateClient`. */
export function makeMagicLinkRedirects(getConfig: () => GateConfig) {
  return {
    /** List every allowlisted redirect target for the active project. */
    async list(): Promise<Envelope<{ redirects: MagicLinkRedirect[] }>> {
      const config = getConfig();
      return requestWith<{ redirects: MagicLinkRedirect[] }>(config, {
        method: "GET",
        path: magicLinkRedirectsPath(config),
      });
    },

    /**
     * Register a new redirect target. `redirectUrl` must exact-match
     * what a customer later passes to `requestMagicLink` — the gateway
     * enforces exact match, never a prefix or wildcard.
     */
    async add(input: AddMagicLinkRedirectInput): Promise<Envelope<{ redirect: MagicLinkRedirect }>> {
      const config = getConfig();
      return requestWith<{ redirect: MagicLinkRedirect }>(config, {
        method: "POST",
        path: magicLinkRedirectsPath(config),
        body: input,
      });
    },

    /**
     * Make an already-registered redirect target the default, without removing and re-adding it. The gateway
     * demotes the previous default in the same step, so there is never a moment with two defaults or none.
     */
    async setDefault(id: string): Promise<Envelope<{ redirect: MagicLinkRedirect }>> {
      const config = getConfig();
      return requestWith<{ redirect: MagicLinkRedirect }>(config, {
        method: "PATCH",
        path: magicLinkRedirectsPath(config, id),
        body: { isDefault: true },
      });
    },

    /** Remove a previously-registered redirect target by its `id`. */
    async remove(id: string): Promise<Envelope<RemoveMagicLinkRedirectResult>> {
      const config = getConfig();
      return requestWith<RemoveMagicLinkRedirectResult>(config, {
        method: "DELETE",
        path: magicLinkRedirectsPath(config, id),
      });
    },
  };
}

/** Singleton bound to the module-level `configureGate()` config. */
export const magicLinkRedirects = makeMagicLinkRedirects(getGateConfig);

export type MagicLinkRedirectsNamespace = ReturnType<typeof makeMagicLinkRedirects>;
