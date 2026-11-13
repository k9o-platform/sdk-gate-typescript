/**
 * JWT verification primitives for apps that consume Gate-issued tokens without the rest of the SDK: verify the
 * signature, read the claims, check scopes. Backed by `jose`.
 */

import { jwtVerify, errors as joseErrors } from "jose";
import type { GateJwtClaims, VerifyJwtFailure, VerifyJwtResult } from "./types.ts";
import { GateError } from "./errors.ts";

/**
 * Configuration for `verifyJwt`. Signing keys come from either the gateway's JWKS route (`jwksUrl`) or an inline key
 * set (`jwks`, for tests and air-gapped deployments).
 */
export type VerifyJwtOptions = {
  token: string;
  /**
   * URL of the gateway's JWKS route: `https://<org>.api.<apex>/@<projectSlug>/auth/jwks` for a project's end-user
   * tokens (`/auth/jwks` on the org host for org keys). The gateway wraps the key set in its response envelope
   * (`{ data: { keys }, meta }`), which `jose` cannot read directly; this helper fetches the URL and unwraps it.
   * Either `jwksUrl` or `jwks` must be set; not both.
   */
  jwksUrl?: string;
  /** Inline JWK set, the standard `{ keys: [...] }` object. */
  jwks?: { keys: ReadonlyArray<Record<string, unknown>> };
  /** Fetch implementation used for `jwksUrl`. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Expected issuer (`iss` claim). Strict comparison. */
  expectedIssuer?: string;
  /** Expected audience (`aud` claim). */
  expectedAudience?: string;
  /**
   * Allowed signing algorithms. Defaults to `["EdDSA", "RS256", "ES256"]`. Anything outside this set is rejected (defense
   * against algorithm confusion).
   */
  allowedAlgorithms?: ReadonlyArray<string>;
  /** Clock-skew tolerance in seconds. Defaults to 30. Applies to `exp` and `nbf`. */
  clockToleranceSeconds?: number;
};

const DEFAULT_ALLOWED_ALGORITHMS = ["EdDSA", "RS256", "ES256"] as const;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Verify a Gate-issued JWT. Returns a typed result; does NOT throw on
 * verification failure (a `valid: false` result carries the reason).
 *
 * Throws `GateError` only when:
 *   - `jwksUrl` and `jwks` are both unset or both set
 *   - the JWKS fetch fails (UPSTREAM_UNAVAILABLE) or answers something that is not a key set
 */
export async function verifyJwt(opts: VerifyJwtOptions): Promise<VerifyJwtResult> {
  if (opts.jwksUrl !== undefined && opts.jwks !== undefined) {
    throw new GateError({
      code: "INVALID_FIELD_VALUE",
      message: "verifyJwt: pass either jwksUrl OR jwks, not both",
      context: {},
      recommendation: null,
    });
  }
  if (opts.jwksUrl === undefined && opts.jwks === undefined) {
    throw new GateError({
      code: "INVALID_FIELD_VALUE",
      message: "verifyJwt: must pass exactly one of {jwksUrl, jwks}",
      context: {},
      recommendation: null,
    });
  }

  const allowedAlgorithms = opts.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS;
  const clockTolerance = opts.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;

  let keyResolver: Parameters<typeof jwtVerify>[1];
  if (opts.jwksUrl !== undefined) {
    keyResolver = makeLocalJwksResolver(await fetchJwks(opts.jwksUrl, opts.fetch));
  } else {
    keyResolver = makeLocalJwksResolver(opts.jwks!);
  }

  try {
    const result = await jwtVerify(opts.token, keyResolver, {
      ...(opts.expectedIssuer !== undefined ? { issuer: opts.expectedIssuer } : {}),
      ...(opts.expectedAudience !== undefined ? { audience: opts.expectedAudience } : {}),
      algorithms: allowedAlgorithms as string[],
      clockTolerance,
    });
    return { valid: true, claims: result.payload as GateJwtClaims };
  } catch (e) {
    return { valid: false, reason: classifyJoseFailure(e) };
  }
}

/**
 * Extract claims from a JWT WITHOUT verifying the signature. Used by
 * SDK consumers that want to read claim data in client code where
 * signature verification has already happened at a trusted hop (e.g.,
 * a reverse proxy). Caller is responsible for confirming the upstream
 * trust path before consuming these claims for security decisions.
 *
 * Throws `GateError` on malformed input.
 */
export function extractClaims(token: string): GateJwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new GateError({
      code: "INVALID_FIELD_VALUE",
      message: `Malformed JWT: expected 3 dot-separated parts, got ${parts.length}`,
      context: {},
      recommendation: null,
    });
  }
  try {
    const payloadJson = base64UrlDecode(parts[1]!);
    return JSON.parse(payloadJson) as GateJwtClaims;
  } catch (e) {
    throw new GateError({
      code: "INVALID_FIELD_VALUE",
      message: `Malformed JWT payload: ${e instanceof Error ? e.message : String(e)}`,
      context: {},
      recommendation: null,
    });
  }
}

/**
 * Assert that the given claim set contains all of the required scopes.
 * Throws `GateError` with `code: "RBAC_DENY"` if any scope is missing.
 * Returns nothing on success — caller uses the throw-or-pass shape.
 */
export function requireScope(
  claims: GateJwtClaims,
  requiredScopes: ReadonlyArray<string>,
): void {
  const present = new Set(claims.scopes ?? []);
  const missing = requiredScopes.filter((s) => !present.has(s));
  if (missing.length > 0) {
    throw new GateError({
      code: "RBAC_DENY",
      message: `Required scopes missing: ${missing.join(", ")}`,
      context: { missingScopes: missing, presentScopes: Array.from(present) },
      recommendation: null,
    });
  }
}

// ----------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------

type Jwks = { keys: ReadonlyArray<Record<string, unknown>> };

function isJwks(v: unknown): v is Jwks {
  return v !== null && typeof v === "object" && Array.isArray((v as { keys?: unknown }).keys);
}

/**
 * Fetch a JWKS from the gateway. The route answers `{ data: { keys }, meta }`; a bare `{ keys }` (any other JWKS
 * host) is accepted too.
 */
export async function fetchJwks(url: string, fetchImpl: typeof globalThis.fetch | undefined = globalThis.fetch): Promise<Jwks> {
  if (typeof fetchImpl !== "function") {
    throw new GateError({
      code: "INTERNAL_ERROR",
      message: "No fetch implementation available to read the JWKS",
      context: { url },
      recommendation: null,
    });
  }
  let body: unknown;
  let status: number;
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    status = res.status;
    body = await res.json();
  } catch (e) {
    throw new GateError({
      code: "UPSTREAM_UNAVAILABLE",
      message: `Could not read the JWKS at ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url },
      recommendation: null,
    });
  }
  const inner = body !== null && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (isJwks(inner)) return inner;
  if (isJwks(body)) return body;
  throw new GateError({
    code: "UPSTREAM_UNAVAILABLE",
    message: `The JWKS route at ${url} answered ${status} without a key set`,
    context: { url, status },
    recommendation: null,
  });
}

function classifyJoseFailure(e: unknown): VerifyJwtFailure {
  // Map `jose`'s typed errors to our closed reason set per `VerifyJwtFailure`.
  if (e instanceof joseErrors.JWSSignatureVerificationFailed) return "INVALID_SIGNATURE";
  if (e instanceof joseErrors.JWTExpired) return "EXPIRED";
  if (e instanceof joseErrors.JWTClaimValidationFailed) {
    const claim = (e as { claim?: string }).claim;
    if (claim === "aud") return "AUDIENCE_MISMATCH";
    if (claim === "iss") return "ISSUER_MISMATCH";
    if (claim === "nbf") return "NOT_YET_VALID";
    return "MALFORMED";
  }
  if (e instanceof joseErrors.JOSEAlgNotAllowed) return "ALGORITHM_NOT_ALLOWED";
  // Fallback — `jose` raises other errors (parse failures, KID mismatches,
  // etc.) that we lump into `MALFORMED` rather than leaking the per-version
  // taxonomy.
  return "MALFORMED";
}

function base64UrlDecode(input: string): string {
  // Pad to a multiple of 4 + swap urlsafe alphabet -> standard alphabet.
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  // Bun + Node 18+ + browsers all expose `atob`.
  const binary = globalThis.atob(standard);
  // Reassemble bytes back to UTF-8 text.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Build a key resolver for `jose.jwtVerify` from a JWKS object. */
function makeLocalJwksResolver(
  jwks: { keys: ReadonlyArray<Record<string, unknown>> },
): Parameters<typeof jwtVerify>[1] {
  // The `jose` resolver signature is `(header, token) => Promise<KeyLike>`
  // — pull the kid from the header, match against the JWKS, and import.
  return async (header) => {
    const { importJWK } = await import("jose");
    const kid = (header as { kid?: string }).kid;
    let match: Record<string, unknown> | undefined;
    if (kid !== undefined) {
      match = jwks.keys.find((k) => k["kid"] === kid);
    }
    if (match === undefined && jwks.keys.length === 1) {
      // Single-key JWKS — return the only key. Tests typically ship one
      // key in the inline set and may not bother with `kid`.
      match = jwks.keys[0];
    }
    if (match === undefined) {
      throw new joseErrors.JWKSNoMatchingKey("No matching key in inline JWKS for kid");
    }
    const alg = (header as { alg?: string }).alg ?? (match["alg"] as string | undefined);
    return importJWK(match as unknown as Parameters<typeof importJWK>[0], alg);
  };
}
