/**
 * Provider sign-in with a code exchange: `signInWithProvider` keeps a one-time verifier and sends its challenge,
 * `completeSignIn` trades the `#code=` from the redirect for the session. A stubbed fetch and window stand in for the
 * gateway and the browser.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { configureGate, gate, resetGateConfig } from "../src/index.ts";

afterEach(() => {
  resetGateConfig();
  delete (globalThis as { window?: unknown }).window;
});

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stubGateway(responder: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  configureGate({
    mode: "native",
    baseUrl: "https://acme.api.example.test",
    projectSlug: "demo-app",
    partnerToken: "k9o_test",
    fetch: ((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "HEAD") return Promise.resolve(new Response(null, { status: 200 }));
      const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      return Promise.resolve(responder(call));
    }) as unknown as typeof fetch,
  });
  return calls;
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("gate.signInWithProvider", () => {
  it("sends the S256 challenge of a stored 43-character verifier, never the verifier", async () => {
    const assigned: string[] = [];
    (globalThis as { window?: unknown }).window = { location: { assign: (u: string) => assigned.push(u) } };
    const calls = stubGateway(() => json(200, { data: { authorizationUrl: "https://idp.example/auth" }, meta: {} }));
    const storage = memoryStorage();
    await gate.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/cb", storage });
    const stored = JSON.parse(storage.m.get("k9o.gate.signin") as string) as { verifier: string; redirectUri: string };
    expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.redirectUri).toBe("https://app.example.com/cb");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/gate/idp/google/authorize");
    expect(calls[0]?.body).toEqual({
      redirectUri: "https://app.example.com/cb",
      codeChallenge: b64url(createHash("sha256").update(stored.verifier).digest()),
      codeChallengeMethod: "S256",
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain(stored.verifier);
    expect(assigned).toEqual(["https://idp.example/auth"]);
  });

  it("stores no verifier when the authorize call fails", async () => {
    (globalThis as { window?: unknown }).window = { location: { assign: () => {} } };
    stubGateway(() => json(400, { code: "K9O_INVALID_FIELD_VALUE", message: "bad", context: { reason: "code_challenge_required" } }));
    const storage = memoryStorage();
    await expect(gate.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/cb", storage })).rejects.toThrow();
    expect(storage.m.size).toBe(0);
  });
});

describe("gate.completeSignIn", () => {
  const stored = JSON.stringify({ verifier: "v".repeat(43), redirectUri: "https://app.example.com/cb" });

  it("exchanges the code with the stored verifier and redirectUri, then clears the verifier", async () => {
    const calls = stubGateway(() =>
      json(200, { data: { session: { accessToken: "at", refreshToken: "rt", expiresAt: "2026-11-01T12:00:00Z" } }, meta: {} }),
    );
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    const r = await gate.completeSignIn("#code=abc123", { storage });
    expect(r).toEqual({ ok: true, accessToken: "at", refreshToken: "rt", expiresAt: "2026-11-01T12:00:00Z", tokenType: "Bearer" });
    expect(calls[0]?.url).toContain("/gate/idp/exchange");
    expect(calls[0]?.body).toEqual({ code: "abc123", codeVerifier: "v".repeat(43), redirectUri: "https://app.example.com/cb" });
    expect(storage.m.size).toBe(0);
  });

  it("strips the fragment from the address bar", async () => {
    const replaced: string[] = [];
    (globalThis as { window?: unknown }).window = {
      location: { hash: "#code=abc123", pathname: "/auth/callback", search: "?x=1" },
      history: { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
    };
    stubGateway(() => json(200, { data: { session: { accessToken: "a", refreshToken: "r", expiresAt: "e" } }, meta: {} }));
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    await gate.completeSignIn(undefined, { storage });
    expect(replaced).toEqual(["/auth/callback?x=1"]);
  });

  it("returns verifier_missing and makes no request when nothing is stored", async () => {
    const calls = stubGateway(() => json(200, {}));
    const r = await gate.completeSignIn("#code=abc123", { storage: memoryStorage() });
    expect(r).toMatchObject({ ok: false, error: "verifier_missing" });
    expect(calls).toHaveLength(0);
  });

  it("returns malformed_callback when the fragment has no code, and clears the verifier", async () => {
    const calls = stubGateway(() => json(200, {}));
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    expect(await gate.completeSignIn("#foo=bar", { storage })).toMatchObject({ ok: false, error: "malformed_callback" });
    expect(calls).toHaveLength(0);
    expect(storage.m.size).toBe(0);
  });

  it("passes the provider's own error through and clears the verifier", async () => {
    const calls = stubGateway(() => json(200, {}));
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    expect(await gate.completeSignIn("#error=sso_failed&error_description=Denied", { storage })).toEqual({
      ok: false,
      error: "sso_failed",
      errorDescription: "Denied",
    });
    expect(calls).toHaveLength(0);
    expect(storage.m.size).toBe(0);
  });

  it.each(["idp_code_invalid", "idp_code_expired", "idp_code_used", "idp_verifier_mismatch"])("maps the gateway's %s to a result", async (reason) => {
    stubGateway(() => json(401, { code: "K9O_UNAUTHENTICATED", message: "refused", context: { reason } }));
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    expect(await gate.completeSignIn("#code=abc", { storage })).toMatchObject({ ok: false, error: reason });
    expect(storage.m.size).toBe(0);
  });

  it("throws on a server error rather than reporting it as a sign-in result", async () => {
    stubGateway(() => json(500, { code: "K9O_INTERNAL_ERROR", message: "boom" }));
    const storage = memoryStorage();
    storage.setItem("k9o.gate.signin", stored);
    await expect(gate.completeSignIn("#code=abc", { storage })).rejects.toThrow();
  });

  it("no longer exposes parseSignInCallback", () => {
    expect((gate as unknown as Record<string, unknown>).parseSignInCallback).toBeUndefined();
  });
});

describe("the two sign-in routes are called without credentials", () => {
  it("sends no authorization header on authorize or exchange, even with a partnerToken configured", async () => {
    (globalThis as { window?: unknown }).window = { location: { assign: () => {} } };
    const seen: Array<Record<string, string>> = [];
    configureGate({
      mode: "native",
      baseUrl: "https://acme.api.example.test",
      projectSlug: "demo-app",
      partnerToken: "k9o_test",
      fetch: ((_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "HEAD") return Promise.resolve(new Response(null, { status: 200 }));
        seen.push(init?.headers as Record<string, string>);
        const path = String(_url);
        return Promise.resolve(path.includes("/authorize")
          ? json(200, { data: { authorizationUrl: "https://idp.example/auth" }, meta: {} })
          : json(200, { data: { session: { accessToken: "a", refreshToken: "r", expiresAt: "2026-11-02T08:00:00Z" } }, meta: {} }));
      }) as unknown as typeof fetch,
    });
    const storage = memoryStorage();
    await gate.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/cb", storage });
    const r = await gate.completeSignIn("#code=abc", { storage });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    for (const h of seen) {
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
      expect(h["x-gate-mode"]).toBe("native");
    }
  });

  it("reports a 429 as K9O_RATE_LIMITED, not as the limiter's reason text", async () => {
    (globalThis as { window?: unknown }).window = { location: { assign: () => {} } };
    stubGateway((call) =>
      call.url.includes("/authorize")
        ? json(200, { data: { authorizationUrl: "https://idp.example/auth" }, meta: {} })
        : json(429, { code: "K9O_RATE_LIMITED", message: "Too many requests", context: { scope: "project", reason: "exchange_burst" } }),
    );
    const storage = memoryStorage();
    await gate.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/cb", storage });
    const r = await gate.completeSignIn("#code=abc", { storage });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe("K9O_RATE_LIMITED");
  });
});
