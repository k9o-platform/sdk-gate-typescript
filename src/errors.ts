/**
 * Gate error shapes. `GateError` is `KError`-compatible —
 * downstream catch blocks can `instanceof GateError`-narrow without
 * importing the gateway's `KError` class directly (the SDK is a customer-
 * facing dependency; reaching across to the gateway's internal error
 * type would be a layering violation).
 *
 * The taxonomy below is the closed set of names the SDK types; a code the
 * SDK does not know is passed through as the gateway sent it.
 */

/**
 * Error codes the SDK names. Strings are the wire format —
 * camelCase-cased KError families per the convention.
 */
type KnownGateErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_FIELD_VALUE"
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_CREDENTIALS"
  | "SESSION_EXPIRED"
  | "REFRESH_TOKEN_INVALID"
  | "TIER_FEATURE_GATED"
  | "RBAC_DENY"
  // FORBIDDEN + NOT_FOUND are surfaced by the gate.idpProviders.*
  // sub-namespaces (project-membership gate + resource-existence checks).
  | "FORBIDDEN"
  | "NOT_FOUND"
  // GATE_REDIRECT_NOT_ALLOWED — magic-link `redirectUrl` not in the project's
  // redirect allowlist (open-redirect-safe exact-match, per-project
  // allowlist capability).
  | "GATE_REDIRECT_NOT_ALLOWED"
  | "POLICY_AUTHORING_AUTHORITY_INSUFFICIENT"
  | "UPSTREAM_UNAVAILABLE"
  // The locate door: a region is down (503, safe to retry after the hint) or the caller is rate-limited (429, safe to retry).
  | "GATE_REGION_UNAVAILABLE"
  | "RATE_LIMITED"
  // Client-side configuration errors raised by `configureGate` / `createGateClient`, never sent by the gateway.
  | "K9O_INVALID_BASE_URL"
  | "K9O_INVALID_FIELD_VALUE"
  | "INTERNAL_ERROR";

/**
 * Error code. A code the SDK names is one of its typed strings. Any other code the gateway sends is kept as the
 * full wire code (for example `K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED`), so the type also admits any string.
 */
export type GateErrorCode = KnownGateErrorCode | (string & {});

const KNOWN_GATE_ERROR_CODES: ReadonlyArray<KnownGateErrorCode> = [
  "UNAUTHENTICATED",
  "INVALID_FIELD_VALUE",
  "EMAIL_ALREADY_REGISTERED",
  "INVALID_CREDENTIALS",
  "SESSION_EXPIRED",
  "REFRESH_TOKEN_INVALID",
  "TIER_FEATURE_GATED",
  "RBAC_DENY",
  "FORBIDDEN",
  "NOT_FOUND",
  "GATE_REDIRECT_NOT_ALLOWED",
  "POLICY_AUTHORING_AUTHORITY_INSUFFICIENT",
  "UPSTREAM_UNAVAILABLE",
  "GATE_REGION_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
];

function isKnownGateErrorCode(code: string): code is KnownGateErrorCode {
  return (KNOWN_GATE_ERROR_CODES as ReadonlyArray<string>).includes(code);
}

/**
 * The fixed sentence an app shows to its users, chosen by status class only. It is never built from the gateway's
 * text. A network failure (no status, `UPSTREAM_UNAVAILABLE`) gets its own sentence.
 */
function publicMessageFor(status: number | null, code: string): string {
  if (status === 401 || status === 403) return "You are not signed in or not allowed to do this.";
  if (status === 404) return "Not found.";
  if (status === 429) return "Too many attempts. Try again later.";
  if (status !== null && status >= 500 && status <= 599) return "Something went wrong. Try again later.";
  if (status === null && code === "UPSTREAM_UNAVAILABLE") return "Could not reach the service.";
  return "The request could not be completed.";
}

/**
 * Surface error thrown by the SDK. Mirrors the gateway's `KError` shape
 * `code` (closed taxonomy), `message` (human-readable),
 * `context` (structured per-code payload), `recommendation` (action the
 * caller can take, or null when there's no canonical recommendation).
 *
 * `publicMessage` is the text an app shows its users; `message`, `recommendation` and `context` are for logs.
 */
export class GateError extends Error {
  readonly code: GateErrorCode;
  readonly context: Readonly<Record<string, unknown>>;
  readonly recommendation: string | null;
  /** Seconds the gateway asks the caller to wait, when it sent one; otherwise `null`. */
  readonly retryAfterSec: number | null;
  /** HTTP status the gateway returned (if the error came from a wire response). */
  readonly status: number | null;
  /** The gateway's request id (the `x-k9o-request-id` response header), or `null` when no response carried one. */
  readonly requestId: string | null;
  /** A fixed sentence chosen by status class, safe to show to an app's users. */
  readonly publicMessage: string;

  constructor(init: {
    code: GateErrorCode;
    message: string;
    context?: Record<string, unknown>;
    recommendation?: string | null;
    retryAfterSec?: number | null;
    status?: number | null;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "GateError";
    this.code = init.code;
    this.context = Object.freeze({ ...(init.context ?? {}) });
    this.recommendation = init.recommendation ?? null;
    this.retryAfterSec = init.retryAfterSec ?? null;
    this.status = init.status ?? null;
    this.requestId = init.requestId ?? null;
    this.publicMessage = publicMessageFor(this.status, this.code);
  }
}

/**
 * Reduce an error for the `errors: "redacted"` mode. A code the SDK does not name becomes `INTERNAL_ERROR`. `message`
 * becomes the `publicMessage`, and `recommendation` and `context` are dropped. `status`, `requestId` and
 * `retryAfterSec` are kept, so a caller can still wait and log.
 */
export function redactGateError(error: GateError): GateError {
  return new GateError({
    code: isKnownGateErrorCode(error.code) ? error.code : "INTERNAL_ERROR",
    message: error.publicMessage,
    context: {},
    recommendation: null,
    retryAfterSec: error.retryAfterSec,
    status: error.status,
    requestId: error.requestId,
  });
}

/**
 * Raised by `configureGate` and `createGateClient` when neither `baseUrl` nor `orgSlug` is given
 * (`K9O_INVALID_BASE_URL`, `context: { field: "baseUrl" }`), when `orgSlug` is malformed
 * (`K9O_INVALID_FIELD_VALUE`, `context: { field: "orgSlug", slug }`), or when `errors` is neither `"full"` nor
 * `"redacted"` (`K9O_INVALID_FIELD_VALUE`, `context: { field: "errors", value }`). It is a {@link GateError}.
 */
export class K9OGateConfigError extends GateError {
  constructor(init: {
    code: "K9O_INVALID_BASE_URL" | "K9O_INVALID_FIELD_VALUE";
    message: string;
    context: Record<string, unknown>;
    recommendation?: string | null;
  }) {
    super(init);
    this.name = "K9OGateConfigError";
  }
}

/**
 * Wire-shape sentinel matching the gateway's `KError` JSON payload. The
 * client uses this to recognise gateway responses and rehydrate them
 * into a `GateError` instance with the right code + context preserved.
 */
export type KErrorWire = {
  code: string;
  message: string;
  context?: Record<string, unknown>;
  /** A string or null; the gateway may also send an object such as `{ action }` or `{ retryAfterSec, note }`. */
  recommendation?: unknown;
};

/**
 * Narrow a wire `KError` to a strongly-typed `GateError`. A code the SDK
 * names keeps its bare name (the `K9O_` prefix is stripped). Any other code
 * is kept as the gateway sent it, so a configuration fault is not read as a
 * transient `INTERNAL_ERROR`. The full wire code is also kept in
 * `context.originalCode`.
 */
export function gateErrorFromWire(wire: KErrorWire, status: number, requestId: string | null = null): GateError {
  // Wire codes are platform-namespaced (`K9O_*`);
  // strip the prefix to match the SDK's bundled bare-code enum.
  const stripped = wire.code.replace(/^K9O_/, "");
  const code: GateErrorCode = isKnownGateErrorCode(stripped) ? stripped : wire.code;
  const context = { ...(wire.context ?? {}), originalCode: wire.code };
  const { recommendation, retryAfterSec } = decodeRecommendation(wire.recommendation);
  return new GateError({
    code,
    message: wire.message,
    context,
    recommendation,
    retryAfterSec,
    status,
    requestId,
  });
}

/**
 * Read the wire `recommendation`, which is a string, null, or an object
 * (`{ action }` or `{ retryAfterSec, note }`). A string is kept; an object gives
 * its `action`, else its `note`, when that is a string; anything else gives null.
 * `retryAfterSec` is the object's number when it is finite and not negative.
 */
function decodeRecommendation(raw: unknown): { recommendation: string | null; retryAfterSec: number | null } {
  if (typeof raw === "string") return { recommendation: raw, retryAfterSec: null };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { recommendation: null, retryAfterSec: null };
  const o = raw as Record<string, unknown>;
  const recommendation = typeof o["action"] === "string" ? o["action"] : typeof o["note"] === "string" ? o["note"] : null;
  const n = o["retryAfterSec"];
  const retryAfterSec = typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  return { recommendation, retryAfterSec };
}
