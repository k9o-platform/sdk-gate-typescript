/**
 * `gate.identityProviders` namespace — project-scoped end-user IdP
 * provider-config management.
 *
 * Wraps the live gateway route family shipped in
 * `services/gateway/src/routes/project-identity-providers.ts`, mounted on
 * the project plane (`<orgSlug>.api.k9o.io/@<projectSlug>/identity-providers`):
 *
 *   POST   /@<projectSlug>/identity-providers          — create (PROJECT_ADMIN)
 *   GET    /@<projectSlug>/identity-providers          — list   (READ_ROLES)
 *   PATCH  /@<projectSlug>/identity-providers/:epcId   — update (PROJECT_ADMIN)
 *   POST   /@<projectSlug>/identity-providers/:epcId/test — testProvider (PROJECT_ADMIN)
 *
 * `create()` + `list()` back the Gate Studio `FederationPresetsPanel`; `update()` backs its
 * `DirectorySyncPanel` (directory-sync settings are read off `list()` and written via `update()`, replacing
 * the unanswered `federation.getDirectorySync`/`updateDirectorySync` bridge messages). Read-one/delete stay
 * unbound until a caller needs them (the SDK does not speculatively surface routes).
 *
 * Auth: operator JWT with PROJECT_ADMIN+ role, server-enforced by the
 * gateway RBAC layer (`requireProjectAdmin`); end-user JWTs (`eu_`-prefixed
 * subjects) are rejected at the route. The bearer is taken from
 * `partnerToken` in config, or per-call via the client's bearer plumbing.
 *
 * 🔴 `clientSecretRef` is a RAW SECRET on the way in, not a reference.
 * The gateway encrypts the submitted value (AES-256-GCM under
 * `K9O_SECRET_STORAGE_MASTER_KEY`) into the opaque `client_secret_enc`
 * handle and persists only that; the field name is retained for wire
 * compatibility and there is no Kibo custody on this path. Reads NEVER carry the secret or its
 * handle: they carry only `clientSecretSet` (a presence boolean,
 * the write-only fix). `serviceAccountKey` (directory sync) follows the same write-only rule.
 */

import { getGateConfig, type GateConfig } from "../mode.ts";
import { requestWith } from "../client.ts";
import { resolveProjectPathRoot } from "../paths.ts";
import type { Envelope } from "../types.ts";

/** Closed end-user-class provider enum (11 values). */
export type IdpProviderKind =
  | "google" | "github" | "microsoft" | "oidc" | "saml" | "scim"
  | "ldap" | "active_directory" | "apple" | "facebook" | "twitter";

/**
 * The result of a provider connectivity test (`testProvider`). `ok` is the reachability + metadata-validity
 * verdict; `reason` (present only when `!ok`) is a CLOSED-enum machine code, NEVER the upstream response body
 * or any credential material. v1 is a NO-SECRET probe: it validates the issuer/metadata
 * endpoint is reachable + structurally valid; it never transmits the stored client secret. `credentials_rejected`
 * is deliberately NOT a v1 reason — the secret is never used, so it cannot be validated (a v2 concern).
 */
export type FederationTestProviderResult = {
  ok: boolean;
  reason?:
    | "endpoint_unreachable"
    | "endpoint_forbidden"
    | "metadata_invalid"
    | "secret_not_provisioned"
    | "kind_unsupported";
};

/**
 * The provider-config metadata shape returned by every read surface and
 * mutation response (`shapeIdpConfig`). Mirrors the gateway wire shape
 * one-to-one.
 *
 * Reads carry `clientSecretSet` (presence only), never the secret or a handle (see the module header).
 * `metadataUrl`/`updatedAt` are `null` until set; `attributeMap` defaults to `{}`; `allowedRedirectUris`
 * defaults to `[]`. The `directory*` fields are scheduled directory sync (Google only):
 * settings plus the scheduler's last-run status; the service-account key itself is never returned.
 */
export type IdpConfig = {
  id: string;
  projectId: string;
  idpProvider: IdpProviderKind;
  displayName: string;
  clientId: string;
  /** Whether a client secret is stored. The secret (and any handle to it) is write-only. */
  clientSecretSet: boolean;
  redirectUri: string;
  metadataUrl: string | null;
  attributeMap: Record<string, unknown>;
  enabled: boolean;
  allowedRedirectUris: string[];
  directoryPullEnabled: boolean;
  directorySyncSubject: string | null;
  directorySyncIntervalMins: number | null;
  directorySyncLastRunAt: string | null;
  directorySyncLastStatus: string | null;
  createdAt: string;
  updatedAt: string | null;
};

/** Directory-sync write fields — accepted on create AND update (one PROJECT_ADMIN surface). */
export type DirectorySyncInput = {
  /** Enabling requires `idpProvider: "google"`, a `serviceAccountKey` (now or already stored) and an interval. */
  directoryPullEnabled?: boolean;
  directorySyncIntervalMins?: number;
  /** The raw Google service-account key JSON. Write-only: encrypted at rest server-side, never returned. */
  serviceAccountKey?: string;
  /** The Workspace admin user the service account impersonates (domain-wide delegation subject). */
  directorySyncSubject?: string;
};

/**
 * Create-request body — mirrors the gateway `CreateIdpBody` (t.Object)
 * exactly, including which fields are optional.
 */
export type CreateIdpInput = {
  idpProvider: IdpProviderKind;
  displayName: string;
  clientId: string;
  /**
   * The OAuth2 client secret. Sent over TLS; encrypted-at-rest server-side
   * (AES-256-GCM) and never returned. Named `clientSecretRef` for wire
   * compatibility — it is NOT a reference on the way in (see module header).
   */
  clientSecretRef: string;
  /** Optional: the gateway derives the callback URL for the provider; omit it, or send exactly the derived value. */
  redirectUri?: string;
  /** Optional; `null`/omitted for providers that don't use discovery metadata. */
  metadataUrl?: string | null;
  /** Optional claim→attribute mapping; defaults to `{}` server-side. */
  attributeMap?: Record<string, string>;
  /** Defaults to `false` server-side — a provider is created disabled. */
  enabled?: boolean;
  /**
   * Customer SPA origins the SDK gate flow (`gate.signInWithProvider`) may
   * hand session tokens back to. Origin-matched + fail-closed at authorize,
   * so an empty/omitted list means SDK sign-in is disabled for this provider
   * until an origin is registered. Defaults to `[]` server-side.
   */
  allowedRedirectUris?: string[] | null;
} & DirectorySyncInput;

/**
 * Update-request body — mirrors the gateway `PatchIdpBody` exactly: every field optional; `idpProvider` is
 * immutable after create. An empty patch returns the current config unchanged.
 *
 * 🔴 For `oidc`/`microsoft`, changing `metadataUrl` WITHOUT `clientSecretRef` in the same patch CLEARS the
 * stored client secret (the gateway's secret-invalidate-on-host-change control): re-supply the
 * secret whenever the metadata URL changes.
 */
export type PatchIdpInput = {
  displayName?: string;
  clientId?: string;
  /** The raw client secret (write-only; see the module header). */
  clientSecretRef?: string;
  redirectUri?: string;
  metadataUrl?: string | null;
  attributeMap?: Record<string, string>;
  enabled?: boolean;
  allowedRedirectUris?: string[] | null;
} & DirectorySyncInput;

function identityProvidersPath(config: GateConfig): string {
  return `${resolveProjectPathRoot(config)}/identity-providers`;
}

/** Factory — produces an `identityProviders` namespace bound to the supplied
 *  config getter. Used by both the `gate` singleton + `createGateClient`. */
export function makeIdentityProviders(getConfig: () => GateConfig) {
  return {
    /**
     * Register a new end-user IdP provider config for the configured
     * project. PROJECT_ADMIN+ required (server-enforced). The plaintext
     * client secret is encrypted-at-rest server-side; the returned config
     * carries only the opaque secret handle.
     */
    async create(input: CreateIdpInput): Promise<Envelope<IdpConfig>> {
      const config = getConfig();
      return requestWith<IdpConfig>(config, {
        method: "POST",
        path: identityProvidersPath(config),
        body: input,
      });
    },

    /**
     * List the configured end-user IdP provider configs for the project.
     * READ_ROLES-gated server-side (PROJECT_ADMIN/EDITOR/MEMBER/VIEWER/AUTHOR/
     * ANALYST) — the SAME shape + roles as the existing GET route
     * (`listProviders` returns the existing route's shape, no
     * confidentiality-narrower endpoint). Each `IdpConfig` carries the opaque
     * secret handle, never the secret. Callers that only need the summary
     * (`id`/`idpProvider`/`displayName`/`enabled`) pick fields off
     * the result — no server change needed for that shaping.
     */
    async list(): Promise<Envelope<IdpConfig[]>> {
      const config = getConfig();
      return requestWith<IdpConfig[]>(config, {
        method: "GET",
        path: identityProvidersPath(config),
      });
    },

    /**
     * Test connectivity to a configured provider by id — a NO-SECRET reachability + metadata-validity probe
     * (no-secret): the gateway resolve-and-pins the issuer/metadata endpoint (SSRF-fenced) and
     * validates it structurally, WITHOUT decrypting or transmitting the stored client secret. Returns
     * `{ok, reason?}`; the `reason` is a closed machine code, never the upstream body or any credential.
     * PROJECT_ADMIN required (server-enforced) — it triggers live external egress on the platform's behalf.
     */
    /**
     * Update a provider config by id (PATCH; PROJECT_ADMIN, server-enforced). Partial: only supplied fields
     * change; `idpProvider` is immutable. Returns the updated config (secrets never included).
     * Write directory-sync settings here and read their status back off `list()`. See `PatchIdpInput`
     * for the metadataUrl-change-clears-secret rule.
     */
    async update(configId: string, patch: PatchIdpInput): Promise<Envelope<IdpConfig>> {
      const config = getConfig();
      return requestWith<IdpConfig>(config, {
        method: "PATCH",
        path: `${identityProvidersPath(config)}/${encodeURIComponent(configId)}`,
        body: patch,
      });
    },

    async testProvider(configId: string): Promise<Envelope<FederationTestProviderResult>> {
      const config = getConfig();
      return requestWith<FederationTestProviderResult>(config, {
        method: "POST",
        path: `${identityProvidersPath(config)}/${encodeURIComponent(configId)}/test`,
      });
    },
  };
}

/** Singleton bound to the module-level `configureGate()` config. */
export const identityProviders = makeIdentityProviders(getGateConfig);

export type IdentityProvidersNamespace = ReturnType<typeof makeIdentityProviders>;
