/**
 * HTTP client abstraction for the Gate SDK.
 *
 * Centralises:
 *   - URL construction against the configured `baseUrl` + per-call path
 *   - the standard response envelope check on success
 *   - the `KError` rehydration on failure via `gateErrorFromWire`
 *   - mode-routing via the `X-Gate-Mode` header (so the gateway routes
 *     consumption to the right billing surface without per-function
 *     branching at the SDK)
 *
 * Customers don't reach for this directly; it's the internal client
 * every `gate.*` function consumes. `request`/`requestWith` are
 * module-internal only — neither `index.ts` nor the `package.json`
 * `exports` map re-exports them, so they are not part of the public
 * `@k9o/gate` surface. In-package `gate.*` bindings and the test suite
 * import them from this module directly.
 */

import { getGateConfig, type GateConfig } from "./mode.ts";
import { resolveRegionalOrigin } from "./region.ts";
import { GateError, type KErrorWire, gateErrorFromWire, redactGateError } from "./errors.ts";
import type { Envelope } from "./types.ts";

export type RequestInit = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Optional JSON body — serialised by the client. */
  body?: unknown;
  /** Optional per-call bearer token. Falls back to `partnerToken` from config when omitted. */
  bearerToken?: string;
  /** Send no `Authorization` header, not even the configured `partnerToken`. For the two sign-in routes a browser calls cross-origin. */
  anonymous?: boolean;
  /** Send to this origin instead of the client's regional base. Set only by the credential flows, after the locate rule. */
  origin?: string;
  /** Optional additional headers; merged with the defaults. */
  headers?: Record<string, string>;
  /** Optional query parameters. */
  query?: Record<string, string | number | boolean | undefined>;
};

/**
 * Issue a request against the Gate API. Returns the unwrapped envelope
 * data on 2xx; throws a `GateError` carrying the closed-taxonomy `code`
 * + structured `context` on non-2xx.
 *
 * Implementation notes:
 *   - The function pulls config lazily so `configureGate()` order doesn't
 *     have to predate import-time module evaluation.
 *   - `fetch` is taken from config when set, else from the global; this
 *     keeps the SDK portable across Bun + Node 18+ + browsers + test
 *     fixtures that supply a stub.
 *   - JSON parsing of non-JSON responses throws — gateway always returns
 *     JSON, so a parse failure is an upstream defect.
 */
export async function request<T>(init: RequestInit): Promise<Envelope<T>> {
  return requestWith<T>(getGateConfig(), init);
}

/**
 * Issue a request using an explicit config (used by per-instance clients
 * returned from `createGateClient`). Singleton callers reach for
 * `request()` which delegates here against the module-level config.
 */
export async function requestWith<T>(
  config: GateConfig,
  init: RequestInit,
): Promise<Envelope<T>> {
  try {
    return await sendRequest<T>(config, init);
  } catch (e) {
    // `errors: "redacted"` reduces every error this request throws, not only gateway answers.
    if (config.errors === "redacted" && e instanceof GateError) throw redactGateError(e);
    throw e;
  }
}

async function sendRequest<T>(config: GateConfig, init: RequestInit): Promise<Envelope<T>> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new GateError({
      code: "INTERNAL_ERROR",
      message:
        "No fetch implementation available — configure {fetch} in configureGate() for non-browser, non-Bun, non-Node-18+ environments",
      context: {},
      recommendation: null,
    });
  }

  const url = buildUrl(init.origin ?? (await resolveRegionalOrigin(config)), init.path, init.query);
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-gate-mode": config.mode,
    ...(init.headers ?? {}),
  };
  const bearer = init.anonymous === true ? undefined : (init.bearerToken ?? config.partnerToken);
  if (typeof bearer === "string" && bearer.length > 0) {
    headers["authorization"] = `Bearer ${bearer}`;
  }
  const requestInit: Record<string, unknown> = {
    method: init.method,
    headers,
  };
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    requestInit["body"] = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit as Parameters<typeof fetchImpl>[1]);
  } catch (e) {
    throw new GateError({
      code: "UPSTREAM_UNAVAILABLE",
      message: `Network error reaching ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url },
      recommendation: null,
    });
  }

  // The gateway's request id, when this response carried one. Read here, where the response is in hand.
  const requestId = response.headers.get("x-k9o-request-id");

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (e) {
    throw new GateError({
      code: "INTERNAL_ERROR",
      message: `Failed to parse JSON response from ${url}: ${e instanceof Error ? e.message : String(e)}`,
      context: { url, status: response.status },
      recommendation: null,
      status: response.status,
      requestId,
    });
  }

  if (response.status >= 200 && response.status < 300) {
    if (!isEnvelope<T>(parsed)) {
      throw new GateError({
        code: "INTERNAL_ERROR",
        message: `Malformed envelope from ${url}: expected {data, meta}`,
        context: { url, status: response.status },
        recommendation: null,
        status: response.status,
        requestId,
      });
    }
    return parsed;
  }

  // Non-2xx: the gateway returns a KError-shaped JSON payload.
  if (isKErrorWire(parsed)) {
    throw gateErrorFromWire(parsed, response.status, requestId);
  }
  throw new GateError({
    code: "INTERNAL_ERROR",
    message: `Upstream returned ${response.status} with non-KError body`,
    context: { url, status: response.status, body: parsed },
    recommendation: null,
    status: response.status,
    requestId,
  });
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestInit["query"],
): string {
  const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${trimmedBase}${trimmedPath}`;
  if (query !== undefined) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs.length > 0) url += `?${qs}`;
  }
  return url;
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  if (value === null || typeof value !== "object") return false;
  const v = value as { data?: unknown; meta?: unknown };
  return "data" in v && "meta" in v && typeof v.meta === "object" && v.meta !== null;
}

function isKErrorWire(value: unknown): value is KErrorWire {
  if (value === null || typeof value !== "object") return false;
  const v = value as { code?: unknown; message?: unknown };
  return typeof v.code === "string" && typeof v.message === "string";
}
