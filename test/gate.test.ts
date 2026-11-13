/**
 * `gate.ts` unit tests — marquee surface (signUp / signIn / signOut /
 * whoami / refreshToken / verifySession) call shapes against a stubbed
 * fetch.
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
    // The credential flows ask the locate door first; these tests are about the call after it (locate.test.ts covers the door).
    if (call.url.endsWith("/gate/locate")) {
      return Promise.resolve(new Response(JSON.stringify({ data: { region: "de01", origin: null }, meta: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    }
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

describe("gate.signUp", () => {
  it("POSTs to /@<slug>/gate/signup with the supplied body + returns AuthResult envelope", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(201, {
        data: {
          user: {
            id: "eu_new1",
            email: "a@b.com",
            status: "active",
            createdAt: "2026-05-12T22:00:00Z",
            updatedAt: null,
            lastSigninAt: null,
            roles: ["PROJECT_END_USER"],
            groups: [],
          },
          session: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: "2026-05-13T22:00:00Z",
          },
        },
        meta: {},
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.signUp({ email: "a@b.com", password: "correct-horse-battery-staple" });
    expect(envelope.data.user.id).toBe("eu_new1");
    expect(envelope.data.session.accessToken).toBe("access-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/gate/signup");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ email: "a@b.com", password: "correct-horse-battery-staple" });
  });

  it("sends displayName, and the input type is closed: a free-form context is a compile error", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(201, {
        data: {
          user: { id: "eu_new2", email: "a@b.com", emailVerified: false, status: "active", createdAt: "2026-10-10T00:00:00Z" },
          session: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: "2026-10-10T01:00:00Z" },
        },
        meta: {},
      }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    await gate.signUp({ email: "a@b.com", password: "correct-horse-battery-staple", displayName: "A B" });
    expect(calls[0]?.body).toEqual({ email: "a@b.com", password: "correct-horse-battery-staple", displayName: "A B" });
    // The gateway refuses any field outside { email, password, displayName }; the type must not offer one.
    // @ts-expect-error `context` is not part of the sign-up body
    const withContext: Parameters<typeof gate.signUp>[0] = { email: "a@b.com", password: "x", context: { source: "x" } };
    void withContext;
  });

  it("propagates EMAIL_ALREADY_REGISTERED as a GateError", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(409, {
        code: "K9O_EMAIL_ALREADY_REGISTERED",
        message: "email is already registered",
        context: { email: "a@b.com" },
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
      await gate.signUp({ email: "a@b.com", password: "x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});

describe("gate.signIn", () => {
  it("POSTs to /gate/signin and returns AuthResult envelope", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, {
        data: {
          user: {
            id: "eu_existing",
            email: "a@b.com",
            status: "active",
            createdAt: "2026-05-01T00:00:00Z",
            updatedAt: null,
            lastSigninAt: "2026-05-12T22:00:00Z",
            roles: ["PROJECT_END_USER"],
            groups: ["group-x"],
          },
          session: { accessToken: "a", refreshToken: "r", expiresAt: "2026-05-13T22:00:00Z" },
        },
        meta: {},
      }),
    );
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.signIn({ email: "a@b.com", password: "x" });
    expect(envelope.data.user.id).toBe("eu_existing");
    expect(envelope.data.user.groups).toEqual(["group-x"]);
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/gate/signin");
  });

  it("INVALID_CREDENTIALS propagates as GateError with code 401", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(401, {
        code: "K9O_INVALID_CREDENTIALS",
        message: "email or password is incorrect",
      }),
    );
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: GateError | null = null;
    try {
      await gate.signIn({ email: "x@y.com", password: "wrong" });
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect(caught?.code).toBe("INVALID_CREDENTIALS");
    expect(caught?.status).toBe(401);
  });
});

describe("gate.signOut", () => {
  it("POSTs the refresh token to /gate/signout and returns { revoked }", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { revoked: true }, meta: {} }),
    );
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.signOut({ refreshToken: "device-token-x" });
    expect(envelope.data.revoked).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/gate/signout");
    expect(calls[0]?.body).toEqual({ refreshToken: "device-token-x" });
  });
});

describe("gate.whoami", () => {
  it("GETs /gate/whoami and returns the user record itself (no wrapper)", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, {
        data: {
          id: "eu_user1",
          email: "a@b.com",
          status: "active",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: null,
          lastSigninAt: "2026-05-12T22:00:00Z",
          roles: ["PROJECT_END_USER"],
          groups: [],
        },
        meta: {},
      }),
    );
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.whoami();
    expect(envelope.data.id).toBe("eu_user1");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/gate/whoami");
  });
});

describe("gate.refreshToken", () => {
  it("POSTs the refresh token and returns the new access token and the next refresh token", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, {
        data: { accessToken: "access-new", refreshToken: "refresh-next", expiresAt: "2026-05-14T22:00:00Z" },
        meta: {},
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.refreshToken({ refreshToken: "refresh-old" });
    expect(envelope.data.accessToken).toBe("access-new");
    expect(envelope.data.refreshToken).toBe("refresh-next");
    expect(envelope.data.expiresAt).toBe("2026-05-14T22:00:00Z");
    expect(calls[0]?.body).toEqual({ refreshToken: "refresh-old" });
  });

  it.each(["replay", "revoked", "inactive", "max_length"])("an ended session (%s) is a SESSION_EXPIRED GateError with the reason", async (reason) => {
    const { fn } = captureFetch(() =>
      jsonResponse(401, { code: "K9O_SESSION_EXPIRED", message: "session ended", context: { reason } }),
    );
    configureGate({ mode: "native", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    let caught: GateError | null = null;
    try {
      await gate.refreshToken({ refreshToken: "refresh-old" });
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect(caught?.code).toBe("SESSION_EXPIRED");
    expect(caught?.status).toBe(401);
    expect(caught?.context["reason"]).toBe(reason);
  });

  it("errors: redacted drops the reason but keeps the code", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(401, { code: "K9O_SESSION_EXPIRED", message: "session ended", context: { reason: "replay" } }),
    );
    configureGate({ mode: "native", projectSlug: "member-portal", baseUrl: "https://api.example.test", errors: "redacted", fetch: fn });
    let caught: GateError | null = null;
    try {
      await gate.refreshToken({ refreshToken: "refresh-old" });
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught?.code).toBe("SESSION_EXPIRED");
    expect(caught?.context["reason"]).toBeUndefined();
  });
});

describe("gate.revokeAllSessions", () => {
  it("POSTs /auth/sessions/revoke-all with the bearer token and returns { revokedCount }", async () => {
    const seen: { url: string; method: string; auth: string | undefined; body: unknown }[] = [];
    const fn = ((url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, method: init?.method ?? "GET", auth: headers["authorization"], body: init?.body });
      return Promise.resolve(jsonResponse(200, { data: { revokedCount: 3 }, meta: {} }));
    }) as unknown as typeof fetch;
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", partnerToken: "access-token-1", fetch: fn });
    const envelope = await gate.revokeAllSessions();
    expect(envelope.data.revokedCount).toBe(3);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.example.test/@member-portal/auth/sessions/revoke-all");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.auth).toBe("Bearer access-token-1");
    expect(seen[0]?.body).toBeUndefined();
  });

  it("an operator token is a K9O_TRUST_ZONE_VIOLATION GateError (403)", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(403, { code: "K9O_TRUST_ZONE_VIOLATION", message: "This is the end-user surface", context: { subjectShape: "op" } }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", partnerToken: "operator-token", fetch: fn });
    let caught: GateError | null = null;
    try {
      await gate.revokeAllSessions();
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect(caught?.code).toBe("K9O_TRUST_ZONE_VIOLATION");
    expect(caught?.status).toBe(403);
  });

  it("a token for another project is a K9O_PROJECT_SCOPE_MISMATCH GateError (403)", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(403, { code: "K9O_PROJECT_SCOPE_MISMATCH", message: "Token's project audience does not match", context: {} }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", partnerToken: "other-project-token", fetch: fn });
    let caught: GateError | null = null;
    try {
      await gate.revokeAllSessions();
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught?.code).toBe("K9O_PROJECT_SCOPE_MISMATCH");
    expect(caught?.status).toBe(403);
  });
});

describe("project path resolution", () => {
  it("addresses the slug member-plane path `/@<projectSlug>/gate/...` against the org subdomain", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { accessToken: "a", expiresAt: "2026-05-14T22:00:00Z" }, meta: {} }),
    );
    configureGate({
      mode: "native",
      projectSlug: "partner-console-staging",
      baseUrl: "https://acme.api.example.test",
      fetch: fn,
    });
    await gate.refreshToken({ refreshToken: "refresh-token-1" });
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.url).toBe("https://acme.api.example.test/@partner-console-staging/gate/refresh");
  });
});

describe("removed surface", () => {
  it("has no hosted (the gateway has no route for it)", () => {
    const g = gate as unknown as Record<string, unknown>;
    expect(g["hosted"]).toBeUndefined();
  });
});
