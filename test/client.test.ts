/**
 * `client.ts` unit tests — HTTP envelope unwrapping + KError rehydration
 * + mode-header routing.
 *
 * Uses a stub fetch via `configureGate({ fetch })` so no real network
 * traffic happens.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { configureGate, resetGateConfig, GateError } from "../src/index.ts";
import { request } from "../src/client.ts";

afterEach(() => {
  resetGateConfig();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("client.request — happy paths", () => {
  it("unwraps {data, meta} envelope on 2xx", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: ((url: string, init?: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return Promise.resolve(jsonResponse(200, { data: { ok: true }, meta: {} }));
      }) as unknown as typeof fetch,
    });

    const envelope = await request<{ ok: boolean }>({
      method: "GET",
      path: "/@test-project/gate/whoami",
    });
    expect(envelope.data.ok).toBe(true);
    expect(seenUrl).toBe("https://api.example.test/@test-project/gate/whoami");
    expect(seenInit?.method).toBe("GET");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["x-gate-mode"]).toBe("native");
  });

  it("sends the standalone mode header in standalone mode", async () => {
    let modeHeader = "";
    configureGate({
      mode: "standalone",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: ((_url: string, init?: RequestInit) => {
        modeHeader = (init?.headers as Record<string, string>)["x-gate-mode"] ?? "";
        return Promise.resolve(jsonResponse(200, { data: null, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({ method: "GET", path: "/@test-project/gate/whoami" });
    expect(modeHeader).toBe("standalone");
  });

  it("includes Authorization header when partnerToken is set", async () => {
    let authHeader = "";
    configureGate({
      mode: "standalone",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      partnerToken: "partner-jwt-abc",
      fetch: ((_url: string, init?: RequestInit) => {
        authHeader = (init?.headers as Record<string, string>)["authorization"] ?? "";
        return Promise.resolve(jsonResponse(200, { data: null, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({ method: "GET", path: "/@test-project/gate/whoami" });
    expect(authHeader).toBe("Bearer partner-jwt-abc");
  });

  it("per-call bearerToken overrides partnerToken from config", async () => {
    let authHeader = "";
    configureGate({
      mode: "standalone",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      partnerToken: "partner-jwt-abc",
      fetch: ((_url: string, init?: RequestInit) => {
        authHeader = (init?.headers as Record<string, string>)["authorization"] ?? "";
        return Promise.resolve(jsonResponse(200, { data: null, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({
      method: "GET",
      path: "/@test-project/gate/whoami",
      bearerToken: "per-call-token",
    });
    expect(authHeader).toBe("Bearer per-call-token");
  });

  it("serialises body as JSON on POST", async () => {
    let bodySeen = "";
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: ((_url: string, init?: RequestInit) => {
        bodySeen = init?.body as string;
        return Promise.resolve(jsonResponse(201, { data: {}, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({
      method: "POST",
      path: "/@test-project/gate/signup",
      body: { email: "a@b.com", password: "secret" },
    });
    expect(JSON.parse(bodySeen)).toEqual({ email: "a@b.com", password: "secret" });
  });

  it("appends query parameters when supplied", async () => {
    let seenUrl = "";
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: ((url: string, _init?: RequestInit) => {
        seenUrl = url;
        return Promise.resolve(jsonResponse(200, { data: [], meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({
      method: "GET",
      path: "/@test-project/gate/users",
      query: { limit: 10, after: "cursor-x", active: true },
    });
    expect(seenUrl).toContain("limit=10");
    expect(seenUrl).toContain("after=cursor-x");
    expect(seenUrl).toContain("active=true");
  });
});

describe("client.request — error paths", () => {
  it("rehydrates 4xx/5xx KError wire payloads into GateError instances", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() =>
        Promise.resolve(
          jsonResponse(401, {
            code: "K9O_INVALID_CREDENTIALS",
            message: "email or password is incorrect",
            context: {},
            recommendation: null,
          }),
        )) as unknown as typeof fetch,
    });
    let caught: unknown = null;
    try {
      await request({ method: "POST", path: "/@test-project/gate/signin", body: {} });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    const err = caught as GateError;
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.status).toBe(401);
    expect(err.message).toContain("incorrect");
  });

  it("unknown server codes keep their wire code, with originalCode preserved", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() =>
        Promise.resolve(
          jsonResponse(500, {
            code: "FUTURE_UNHANDLED_CODE",
            message: "something else broke",
          }),
        )) as unknown as typeof fetch,
    });
    let caught: unknown = null;
    try {
      await request({ method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    const err = caught as GateError;
    expect(err.code).toBe("FUTURE_UNHANDLED_CODE");
    expect(err.context["originalCode"]).toBe("FUTURE_UNHANDLED_CODE");
  });

  it("network failures surface as UPSTREAM_UNAVAILABLE", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    let caught: unknown = null;
    try {
      await request({ method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("malformed 2xx envelope (missing meta) surfaces as INTERNAL_ERROR", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() =>
        Promise.resolve(jsonResponse(200, { data: { ok: true } }))) as unknown as typeof fetch,
    });
    let caught: unknown = null;
    try {
      await request({ method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("INTERNAL_ERROR");
    expect((caught as GateError).message).toContain("envelope");
  });

  it("non-2xx without a KError-shaped body surfaces as INTERNAL_ERROR", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() =>
        Promise.resolve(jsonResponse(500, { not: "a kerror shape" }))) as unknown as typeof fetch,
    });
    let caught: unknown = null;
    try {
      await request({ method: "GET", path: "/x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("INTERNAL_ERROR");
  });
});

describe("client.request — URL construction", () => {
  it("trims trailing slash on baseUrl + leading slash on path", async () => {
    let seenUrl = "";
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test/",
      fetch: ((url: string) => {
        seenUrl = url;
        return Promise.resolve(jsonResponse(200, { data: null, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await request({ method: "GET", path: "no-leading-slash" });
    expect(seenUrl).toBe("https://api.example.test/no-leading-slash");
  });
});

describe("regional host resolution (shared with @k9o/core)", () => {
  it("a credentialed gate call goes to the validated regional host after one unauthenticated HEAD", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
      if (init?.method === "HEAD") return new Response(null, { status: 308, headers: { location: "https://acme.api-de01.example.test/" } });
      if (String(input).endsWith("/gate/locate")) return new Response(JSON.stringify({ data: { region: "de01", origin: null }, meta: {} }), { status: 200 });
      return new Response(JSON.stringify({ data: { valid: false, user: null, session: null }, meta: {} }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const { createGateClient } = await import("../src/client-factory.ts");
    const g = createGateClient({ mode: "standalone", baseUrl: "https://acme.api.example.test", projectSlug: "portal", fetch: f });
    await g.signIn({ email: "a@b.c", password: "pw-should-only-reach-regional" });
    expect(calls[0]!.method).toBe("HEAD");
    expect(calls[0]!.url).toBe("https://acme.api.example.test/");
    expect(JSON.stringify(calls[0]!.headers)).not.toContain("x-gate-mode");
    expect(calls[1]!.url).toBe("https://acme.api-de01.example.test/@portal/gate/locate");
    expect(calls[1]!.headers["authorization"]).toBeUndefined();
    expect(calls[2]!.url).toBe("https://acme.api-de01.example.test/@portal/gate/signin");
  });
});

const CASES: Array<{ name: string; rec: unknown; status: number; expectRec: string | null; expectRetry: number | null }> = [
  { name: "object with action", rec: { action: "Open Billing and settle the outstanding wallet balance to lift the suspension." }, status: 403, expectRec: "Open Billing and settle the outstanding wallet balance to lift the suspension.", expectRetry: null },
  { name: "object with retryAfterSec and note", rec: { retryAfterSec: 30, note: "retry" }, status: 429, expectRec: "retry", expectRetry: 30 },
  { name: "null", rec: null, status: 403, expectRec: null, expectRetry: null },
  { name: "string", rec: "Do the thing.", status: 403, expectRec: "Do the thing.", expectRetry: null },
  { name: "number", rec: 42, status: 403, expectRec: null, expectRetry: null },
  { name: "array", rec: ["a", "b"], status: 403, expectRec: null, expectRetry: null },
  { name: "negative retryAfterSec", rec: { retryAfterSec: -1 }, status: 429, expectRec: null, expectRetry: null },
];
const body = (rec: unknown) => ({ code: "K9O_READ_ONLY_SUSPENDED", message: "Project is suspended.", context: { x: 1 }, recommendation: rec });

describe("client.request — recommendation in the gateway error body", () => {
  for (const c of CASES) {
    it(`rehydrates the GateError when recommendation is ${c.name}`, async () => {
      configureGate({
        mode: "native",
        projectSlug: "test-project",
        baseUrl: "https://api.example.test",
        fetch: (() => Promise.resolve(jsonResponse(c.status, body(c.rec)))) as unknown as typeof fetch,
      });
      const err = (await request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as GateError;
      expect(err).toBeInstanceOf(GateError);
      expect(err.message).toBe("Project is suspended.");
      expect(err.status).toBe(c.status);
      expect(err.context["x"]).toBe(1);
      expect(err.context["originalCode"]).toBe("K9O_READ_ONLY_SUSPENDED");
      expect(err.recommendation).toBe(c.expectRec);
      expect(err.retryAfterSec).toBe(c.expectRetry);
    });
  }
});
