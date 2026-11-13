/**
 * `gate.magicLinkRedirects.*` sub-namespace unit tests.
 *
 * Validates URL construction + method + body + envelope unwrap + error
 * propagation against a stubbed fetch. Targets the live gateway route
 * family at `/@<projectSlug>/gate/magic-link-redirects[/:id]`
 * (`services/gateway/src/routes/gate-magic-link-redirects.ts`).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, gate, resetGateConfig, GateError } from "../src/index.ts";

afterEach(() => {
  resetGateConfig();
});

type FetchCall = { url: string; method: string; body: unknown };

function captureFetch(responder: (call: FetchCall) => Response): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body !== undefined ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return Promise.resolve(responder(call));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const META = {} as Record<string, unknown>;

const SAMPLE_REDIRECT = {
  id: "mlr_abcdef012345",
  redirectUrl: "https://app.example.com/auth/callback",
  isDefault: true,
  createdAt: "2026-08-30T00:00:00Z",
};

describe("gate.magicLinkRedirects.list", () => {
  it("GETs the collection endpoint and unwraps { redirects: [...] }", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { redirects: [SAMPLE_REDIRECT] }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.magicLinkRedirects.list();
    expect(envelope.data.redirects).toHaveLength(1);
    expect(envelope.data.redirects[0]?.id).toBe("mlr_abcdef012345");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/gate/magic-link-redirects");
  });

  it("propagates RBAC_DENY when the caller isn't PROJECT_ADMIN+", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(403, {
        code: "K9O_RBAC_DENY",
        message: "Managing the magic-link redirect allowlist requires PROJECT_ADMIN or higher",
        context: { role: "PROJECT_MEMBER" },
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: unknown = null;
    try {
      await gate.magicLinkRedirects.list();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("RBAC_DENY");
  });
});

describe("gate.magicLinkRedirects.add", () => {
  it("POSTs { redirectUrl, isDefault } and returns { redirect }", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { redirect: SAMPLE_REDIRECT }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.magicLinkRedirects.add({
      redirectUrl: "https://app.example.com/auth/callback",
      isDefault: true,
    });
    expect(envelope.data.redirect.id).toBe("mlr_abcdef012345");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/gate/magic-link-redirects");
    expect(calls[0]?.body).toEqual({
      redirectUrl: "https://app.example.com/auth/callback",
      isDefault: true,
    });
  });

  it("omits isDefault from the body when not supplied (server defaults it)", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { redirect: { ...SAMPLE_REDIRECT, isDefault: false } }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    await gate.magicLinkRedirects.add({ redirectUrl: "https://app.example.com/cb2" });
    expect(calls[0]?.body).toEqual({ redirectUrl: "https://app.example.com/cb2" });
  });

  it("propagates INVALID_FIELD_VALUE on a malformed redirectUrl", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(400, {
        code: "K9O_INVALID_FIELD_VALUE",
        message: "redirectUrl must be 1-2048 characters",
        context: {},
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: unknown = null;
    try {
      await gate.magicLinkRedirects.add({ redirectUrl: "" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });
});

describe("gate.magicLinkRedirects.setDefault", () => {
  it("PATCHes the redirect by id with { isDefault: true } and returns the redirect", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { redirect: SAMPLE_REDIRECT }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.magicLinkRedirects.setDefault("mlr_abcdef012345");
    expect(envelope.data.redirect.id).toBe("mlr_abcdef012345");
    expect(envelope.data.redirect.isDefault).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/magic-link-redirects/mlr_abcdef012345",
    );
    expect(calls[0]?.body).toEqual({ isDefault: true });
  });

  it("propagates NOT_FOUND when the id doesn't exist in this project", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(404, {
        code: "K9O_NOT_FOUND",
        message: "No magic-link redirect 'mlr_doesNotExist' in this project",
        context: { id: "mlr_doesNotExist" },
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: unknown = null;
    try {
      await gate.magicLinkRedirects.setDefault("mlr_doesNotExist");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("NOT_FOUND");
  });
});

describe("gate.magicLinkRedirects.remove", () => {
  it("DELETEs by id (not by redirectUrl) and returns { removed: true, id }", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { removed: true, id: "mlr_abcdef012345" }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.magicLinkRedirects.remove("mlr_abcdef012345");
    expect(envelope.data.removed).toBe(true);
    expect(envelope.data.id).toBe("mlr_abcdef012345");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/magic-link-redirects/mlr_abcdef012345",
    );
  });

  it("propagates NOT_FOUND when the id doesn't exist in this project", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(404, {
        code: "K9O_NOT_FOUND",
        message: "No magic-link redirect 'mlr_doesNotExist' in this project",
        context: { id: "mlr_doesNotExist" },
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: unknown = null;
    try {
      await gate.magicLinkRedirects.remove("mlr_doesNotExist");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("NOT_FOUND");
  });
});

describe("gate.magicLinkRedirects — slug path construction", () => {
  it("addresses the slug member-plane path against the org subdomain", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { redirects: [] }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "partner-console-staging",
      baseUrl: "https://acme.api.example.test",
      fetch: fn,
    });
    await gate.magicLinkRedirects.list();
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.url).toBe(
      "https://acme.api.example.test/@partner-console-staging/gate/magic-link-redirects",
    );
  });
});
