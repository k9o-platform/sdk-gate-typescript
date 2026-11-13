/**
 * Standalone vs Native mode wiring.
 *
 * The SDK surface is identical across modes; the mode only tells the gateway how to route consumption. The SDK
 * records it on every request in the `X-Gate-Mode` header and does not branch on it at call time.
 *
 * Function names, signatures, response envelope and error taxonomy are the same in both modes.
 */

/** Two orthogonal deployment shapes; they are not interleaved. */
export type GateMode = "standalone" | "native";

import { K9OGateConfigError } from "./errors.ts";
import { parseApiHost } from "./api-host.ts";

/**
 * Gate SDK configuration. Returned by `getGateConfig()` and consumed
 * internally by the HTTP client + JWT verifier. Set via `configureGate`
 * at process boot or per-test in unit tests.
 */
export type GateConfig = {
  mode: GateMode;
  /** Project slug (e.g. `member-portal`). Routes resolve to `/@<slug>/gate/...`. Required. */
  projectSlug: string;
  /** Gateway base URL, e.g. `https://<orgSlug>.api.<apex>` */
  baseUrl: string;
  /**
   * Optional partner-credentialled JWT for Standalone mode — used as the
   * default Authorization header when no per-call bearer is supplied.
   * Not required in Native mode; the gateway resolves credentials from
   * the standard project context.
   */
  partnerToken?: string;
  /**
   * Optional fetch override for testing + non-browser environments. The
   * SDK defaults to global `fetch` (available in Bun + Node 18+ +
   * browsers) when not set.
   */
  fetch?: typeof fetch;
  /**
   * How much of an error reaches the caller. `"full"` (the default) keeps the gateway's message, recommendation and
   * context. `"redacted"` keeps the code (an unknown code becomes `INTERNAL_ERROR`), status, `requestId`,
   * `publicMessage` and `retryAfterSec`, and drops the rest.
   */
  errors?: GateErrorDisclosure;
};

/** Value of the `errors` option: `"full"` keeps everything the gateway sent, `"redacted"` keeps only what an app needs. */
export type GateErrorDisclosure = "full" | "redacted";

/**
 * What `configureGate` and `createGateClient` accept. Same as {@link GateConfig}, except `baseUrl` is optional when
 * `orgSlug` is given. The client stores the resolved {@link GateConfig}.
 */
export type GateClientConfig = Omit<GateConfig, "baseUrl"> & {
  /** Gateway base URL. Optional when `orgSlug` is given. */
  baseUrl?: string;
  /**
   * Your organization's slug. With no `baseUrl`, requests go to `https://<orgSlug>.api.k9o.io`. With a platform host
   * (`https://api.<apex>`), the org host `<orgSlug>.api.<apex>` is used. Any other `baseUrl` is used as given.
   */
  orgSlug?: string;
};

let _config: GateConfig | null = null;

/**
 * Initialise the SDK. Must be called before any `gate.*` invocation.
 * Re-calling replaces the prior config wholesale (no per-field merge —
 * keeps the config-set-at-boot ergonomic clean).
 */
export function configureGate(config: GateClientConfig): void {
  _config = resolveGateConfig(config);
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,62}$/;
const DEFAULT_ORG_HOST_SUFFIX = "api.k9o.io";

function validateOrgSlug(slug: string): void {
  if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.endsWith("-")) {
    throw new K9OGateConfigError({
      code: "K9O_INVALID_FIELD_VALUE",
      message: `orgSlug "${String(slug)}" does not match required format ^[a-z][a-z0-9-]{1,62}$ (must not end with '-')`,
      context: { field: "orgSlug", slug },
      recommendation:
        "Pass a slug of 2-63 characters: lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen.",
    });
  }
}

/**
 * Validate the config and resolve its gateway URL. A `baseUrl` that is a platform host (`api.<apex>`, no org, no
 * region) plus an `orgSlug` becomes `<scheme>://<orgSlug>.<host>`. With only an `orgSlug`, the host is
 * `https://<orgSlug>.api.k9o.io`. Any other `baseUrl` (an org host, a regional host, a custom domain, localhost, an IP)
 * is used exactly as given. With neither, this throws a `K9OGateConfigError`.
 */
export function resolveGateConfig(config: GateClientConfig): GateConfig {
  validateErrorsOption(config.errors);
  const hasOrgSlug = config.orgSlug !== undefined;
  const probe = hasOrgSlug && config.baseUrl === undefined ? { ...config, baseUrl: "placeholder" } : config;
  if (config.baseUrl === undefined && !hasOrgSlug) {
    throw new K9OGateConfigError({
      code: "K9O_INVALID_BASE_URL",
      message: "Gate config needs a baseUrl or an orgSlug",
      context: { field: "baseUrl" },
      recommendation: "Pass baseUrl (such as https://acme.api.k9o.io) or orgSlug (such as acme).",
    });
  }
  validateGateConfig(probe as GateConfig);
  let baseUrl: string;
  if (config.baseUrl === undefined) {
    validateOrgSlug(config.orgSlug as string);
    baseUrl = `https://${config.orgSlug as string}.${DEFAULT_ORG_HOST_SUFFIX}`;
  } else {
    baseUrl = config.baseUrl;
    if (hasOrgSlug) {
      let url: URL | null = null;
      try {
        url = new URL(baseUrl);
      } catch {
        url = null;
      }
      const host = url === null ? null : parseApiHost(url.hostname);
      if (url !== null && host !== null && host.orgSlug === null && host.region === null) {
        validateOrgSlug(config.orgSlug as string);
        baseUrl = `${url.protocol}//${config.orgSlug as string}.${url.host}`;
      }
    }
  }
  const { orgSlug: _orgSlug, ...rest } = config;
  return { ...rest, baseUrl, errors: config.errors ?? "full" };
}

function validateErrorsOption(errors: unknown): void {
  if (errors === undefined || errors === "full" || errors === "redacted") return;
  throw new K9OGateConfigError({
    code: "K9O_INVALID_FIELD_VALUE",
    message: `errors "${String(errors)}" is not valid; expected "full" or "redacted"`,
    context: { field: "errors", value: errors },
    recommendation: 'Pass errors: "full" (the default) or errors: "redacted".',
  });
}

/**
 * Validate a config shape. Exposed for `createGateClient` so per-instance
 * configs go through identical checks as the singleton.
 */
export function validateGateConfig(config: GateConfig): void {
  if (config.mode !== "standalone" && config.mode !== "native") {
    throw new TypeError(
      `Invalid Gate mode "${config.mode as string}"; expected "standalone" or "native"`,
    );
  }
  const hasSlug = typeof config.projectSlug === "string" && config.projectSlug.length > 0;
  if (!hasSlug) {
    throw new TypeError(
      `Gate config missing projectSlug (required, slug grammar — project ids are internal-only and never customer-facing)`,
    );
  }
  if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
    throw new TypeError(`Invalid baseUrl "${config.baseUrl}"; expected non-empty string`);
  }
}

/**
 * Read the active config. Throws when called before `configureGate(...)`.
 * Tests can call `resetGateConfig()` to clear between cases.
 */
export function getGateConfig(): GateConfig {
  if (_config === null) {
    throw new Error(
      "@k9o/gate: SDK is not configured. Call configureGate({ mode, projectSlug, baseUrl }) before invoking gate functions.",
    );
  }
  return _config;
}

/** Reset the singleton — used by tests + by app-shutdown teardown paths. */
export function resetGateConfig(): void {
  _config = null;
}
