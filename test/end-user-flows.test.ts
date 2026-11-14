/**
 * Wire-layer tests for the end-user flows: passkeys, TOTP, password reset, invitation redeem and verify-session.
 * Each call is checked for its path, method, body, whether it sends a bearer token, and its answer.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, createGateClient, gate, GateError, resetGateConfig } from "../src/index.ts";

afterEach(() => {
  resetGateConfig();
});

type FetchCall = { url: string; method: string; body: unknown; authorization: string | undefined };

function captureFetch(responder: (call: FetchCall) => Response): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body !== undefined ? JSON.parse(init.body as string) : undefined,
      authorization: headers["authorization"],
    };
    // The credential flows ask the locate door first; these tests are about the call after it.
    if (call.url.endsWith("/gate/locate")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { region: "de01", origin: null }, meta: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    calls.push(call);
    return Promise.resolve(responder(call));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BASE = "https://api.example.test/@member-portal/gate";

function configure(fn: typeof fetch, partnerToken?: string): void {
  configureGate({
    mode: "standalone",
    projectSlug: "member-portal",
    baseUrl: "https://api.example.test",
    fetch: fn,
    ...(partnerToken !== undefined ? { partnerToken } : {}),
  });
}

describe("gate.passkeys.register", () => {
  it("begin POSTs with the configured bearer and returns the options", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { challenge: "ch1", rp: { id: "example.test" } }, meta: {} }));
    configure(fn, "eu_access");
    const out = await gate.passkeys.register.begin();
    expect(out.data.challenge).toBe("ch1");
    expect(calls[0]?.url).toBe(`${BASE}/passkeys/register/begin`);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toBe("Bearer eu_access");
  });

  it("begin takes a per-call bearer over the configured one", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { challenge: "ch1" }, meta: {} }));
    configure(fn, "configured");
    await gate.passkeys.register.begin({ bearerToken: "per_call" });
    expect(calls[0]?.authorization).toBe("Bearer per_call");
  });

  it("finish sends the credential and label and returns the passkey", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { passkey: { id: "eupk_1", credentialId: "cred1" } }, meta: {} }));
    configure(fn, "eu_access");
    const response = { id: "cred1", response: { clientDataJSON: "abc" } };
    const out = await gate.passkeys.register.finish({ response, label: "Laptop" });
    expect(out.data.passkey).toEqual({ id: "eupk_1", credentialId: "cred1" });
    expect(calls[0]?.url).toBe(`${BASE}/passkeys/register/finish`);
    expect(calls[0]?.body).toEqual({ response, label: "Laptop" });
    expect(calls[0]?.authorization).toBe("Bearer eu_access");
  });

  it("finish maps a refused challenge to a GateError", async () => {
    const { fn } = captureFetch(() =>
      json(400, { code: "K9O_INVALID_FIELD_VALUE", message: "Passkey registration challenge invalid, expired, or replayed", context: {}, recommendation: null }),
    );
    configure(fn, "eu_access");
    const err = await gate.passkeys.register.finish({ response: { id: "x", response: {} } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateError);
    expect((err as GateError).status).toBe(400);
  });
});

describe("gate.passkeys.signIn", () => {
  it("begin sends the email and no bearer, even when a token is configured", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { challenge: "ch2", allowCredentials: [] }, meta: {} }));
    configure(fn, "configured");
    const out = await gate.passkeys.signIn.begin({ email: "user@example.com" });
    expect(out.data.challenge).toBe("ch2");
    expect(calls[0]?.url).toBe(`${BASE}/passkeys/signin/begin`);
    expect(calls[0]?.body).toEqual({ email: "user@example.com" });
    expect(calls[0]?.authorization).toBeUndefined();
  });

  it("begin without an email sends an empty body", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { challenge: "ch2" }, meta: {} }));
    configure(fn);
    await gate.passkeys.signIn.begin();
    expect(calls[0]?.body).toEqual({});
  });

  it("finish sends the assertion with no bearer and returns the session", async () => {
    const session = { accessToken: "a", refreshToken: "r", expiresAt: "2026-11-13T10:00:00Z" };
    const { fn, calls } = captureFetch(() => json(200, { data: { session }, meta: {} }));
    configure(fn, "configured");
    const response = { id: "cred1", response: { signature: "sig" } };
    const out = await gate.passkeys.signIn.finish({ response });
    expect(out.data.session).toEqual(session);
    expect(calls[0]?.url).toBe(`${BASE}/passkeys/signin/finish`);
    expect(calls[0]?.body).toEqual({ response });
    expect(calls[0]?.authorization).toBeUndefined();
  });
});

describe("gate.mfa.totp", () => {
  it("enroll POSTs the label with the bearer and returns the factor", async () => {
    const factor = { id: "eumf_1", secret: "BASE32", uri: "otpauth://totp/x?secret=BASE32" };
    const { fn, calls } = captureFetch(() => json(200, { data: { factor }, meta: {} }));
    configure(fn, "eu_access");
    const out = await gate.mfa.totp.enroll({ label: "Phone" });
    expect(out.data.factor).toEqual(factor);
    expect(calls[0]?.url).toBe(`${BASE}/mfa/totp/enroll`);
    expect(calls[0]?.body).toEqual({ label: "Phone" });
    expect(calls[0]?.authorization).toBe("Bearer eu_access");
  });

  it("confirm sends the factor, code and currentCode and returns the factor and a session", async () => {
    const session = { accessToken: "a", refreshToken: "r", expiresAt: "2026-11-13T10:00:00Z" };
    const { fn, calls } = captureFetch(() =>
      json(200, { data: { factor: { id: "eumf_1", verifiedAt: "2026-11-13T09:00:00Z" }, session }, meta: {} }),
    );
    configure(fn, "eu_access");
    const out = await gate.mfa.totp.confirm({ factorId: "eumf_1", code: "123456", currentCode: "654321" });
    expect(out.data.factor.verifiedAt).toBe("2026-11-13T09:00:00Z");
    expect(out.data.session).toEqual(session);
    expect(calls[0]?.url).toBe(`${BASE}/mfa/totp/confirm`);
    expect(calls[0]?.body).toEqual({ factorId: "eumf_1", code: "123456", currentCode: "654321" });
  });

  it("confirm maps a refusal to a GateError carrying the code", async () => {
    const { fn } = captureFetch(() =>
      json(401, { code: "K9O_INVALID_CREDENTIALS", message: "bad code", context: {}, recommendation: null }),
    );
    configure(fn, "eu_access");
    const err = await gate.mfa.totp.confirm({ factorId: "eumf_1", code: "000000" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateError);
    expect((err as GateError).code).toBe("INVALID_CREDENTIALS");
  });
});

describe("gate.mfa.methods", () => {
  it("list GETs with the bearer and returns the methods", async () => {
    const methods = [{ id: "eumf_1", type: "totp", label: "Phone", verifiedAt: "2026-11-13T09:00:00Z", createdAt: "2026-11-13T08:59:00Z" }];
    const { fn, calls } = captureFetch(() => json(200, { data: { methods }, meta: {} }));
    configure(fn, "eu_access");
    const out = await gate.mfa.methods.list();
    expect(out.data.methods).toEqual(methods);
    expect(calls[0]?.url).toBe(`${BASE}/mfa/methods`);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.authorization).toBe("Bearer eu_access");
  });

  it("list accepts a per-call bearer token", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { methods: [] }, meta: {} }));
    configure(fn, "configured");
    await gate.mfa.methods.list({ bearerToken: "eu_other" });
    expect(calls[0]?.authorization).toBe("Bearer eu_other");
  });

  it("delete sends DELETE with the code and returns deleted", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { deleted: true }, meta: {} }));
    configure(fn, "eu_access");
    const out = await gate.mfa.methods.delete("eumf_1", { code: "123456" });
    expect(out.data.deleted).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/mfa/methods/eumf_1`);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.body).toEqual({ code: "123456" });
    expect(calls[0]?.authorization).toBe("Bearer eu_access");
  });

  it("delete of a pending factor sends no body and escapes the id", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { deleted: true }, meta: {} }));
    configure(fn, "eu_access");
    await gate.mfa.methods.delete("a/b");
    expect(calls[0]?.url).toBe(`${BASE}/mfa/methods/a%2Fb`);
    expect(calls[0]?.body).toBeUndefined();
  });

  it("delete maps a missing code to a GateError carrying K9O_MFA_REQUIRED", async () => {
    const { fn } = captureFetch(() =>
      json(401, { code: "K9O_MFA_REQUIRED", message: "needs code", context: { field: "code" }, recommendation: null }),
    );
    configure(fn, "eu_access");
    const err = await gate.mfa.methods.delete("eumf_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateError);
    expect((err as GateError).code).toBe("K9O_MFA_REQUIRED");
  });
});

describe("gate.passwordReset", () => {
  it("request POSTs the email with no bearer", async () => {
    const { fn, calls } = captureFetch(() => json(200, { data: { reset: { requested: true, expiresAt: "2026-11-13T11:00:00Z" } }, meta: {} }));
    configure(fn, "configured");
    const out = await gate.passwordReset.request({ email: "user@example.com" });
    expect(out.data.reset.requested).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/password-reset/request`);
    expect(calls[0]?.body).toEqual({ email: "user@example.com" });
    expect(calls[0]?.authorization).toBeUndefined();
  });

  it("request surfaces a missing mail relay as a GateError", async () => {
    const { fn } = captureFetch(() =>
      json(503, { code: "K9O_EMAIL_NOT_CONFIGURED", message: "no relay", context: {}, recommendation: null }),
    );
    configure(fn);
    const err = await gate.passwordReset.request({ email: "user@example.com" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateError);
    expect((err as GateError).status).toBe(503);
  });

  it("redeem sends the token and new password and returns a session", async () => {
    const session = { accessToken: "a", refreshToken: "r", expiresAt: "2026-11-13T10:00:00Z" };
    const { fn, calls } = captureFetch(() => json(200, { data: { redeemed: true, endUserId: "eu_1", session }, meta: {} }));
    configure(fn, "configured");
    const out = await gate.passwordReset.redeem({ token: "t".repeat(32), newPassword: "correct horse battery" });
    expect(out.data.redeemed).toBe(true);
    expect(out.data.session).toEqual(session);
    expect(calls[0]?.url).toBe(`${BASE}/password-reset/redeem`);
    expect(calls[0]?.authorization).toBeUndefined();
  });

  it("redeem returns an mfa challenge and no session when the account has an authenticator", async () => {
    const mfa = { required: true, challengeId: "c".repeat(32), expiresAt: "2026-11-13T09:05:00Z", methodsAvailable: ["totp"], resident: { region: "de01", origin: "https://api.example.test" } };
    const { fn } = captureFetch(() => json(200, { data: { redeemed: true, endUserId: "eu_1", mfa }, meta: {} }));
    configure(fn);
    const out = await gate.passwordReset.redeem({ token: "t".repeat(32), newPassword: "correct horse battery" });
    expect(out.data.mfa?.challengeId).toBe("c".repeat(32));
    expect(out.data.session).toBeUndefined();
  });
});

describe("gate.invitations.redeem", () => {
  it("sends the token, password and display name with no bearer and returns user and session", async () => {
    const session = { accessToken: "a", refreshToken: "r", expiresAt: "2026-11-13T10:00:00Z" };
    const { fn, calls } = captureFetch(() =>
      json(200, { data: { redeemed: true, user: { id: "eu_2", email: "new@example.com" }, session }, meta: {} }),
    );
    configure(fn, "configured");
    const out = await gate.invitations.redeem({ token: "t".repeat(32), password: "correct horse battery", displayName: "New" });
    expect(out.data.user).toEqual({ id: "eu_2", email: "new@example.com" });
    expect(out.data.session).toEqual(session);
    expect(calls[0]?.url).toBe(`${BASE}/invitations/redeem`);
    expect(calls[0]?.body).toEqual({ token: "t".repeat(32), password: "correct horse battery", displayName: "New" });
    expect(calls[0]?.authorization).toBeUndefined();
  });
});

describe("gate.verifySession", () => {
  it("sends the token in the body with the configured bearer and returns the claims", async () => {
    const claims = { subjectId: "eu_1", projectId: "proj_1", expiresAt: "2026-11-13T10:00:00Z" };
    const { fn, calls } = captureFetch(() => json(200, { data: { valid: true, claims }, meta: {} }));
    configure(fn, "backend_key");
    const out = await gate.verifySession({ token: "end_user_access_token" });
    expect(out.data).toEqual({ valid: true, claims });
    expect(calls[0]?.url).toBe(`${BASE}/verify-session`);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ token: "end_user_access_token" });
    expect(calls[0]?.authorization).toBe("Bearer backend_key");
  });

  it("returns valid: false with a reason for a refused token (not an error)", async () => {
    const { fn } = captureFetch(() => json(200, { data: { valid: false, reason: "AUDIENCE_MISMATCH" }, meta: {} }));
    configure(fn, "backend_key");
    const out = await gate.verifySession({ token: "other_project_token" });
    expect(out.data).toEqual({ valid: false, reason: "AUDIENCE_MISMATCH" });
  });
});

describe("createGateClient exposes the same flows", () => {
  it("has every new method", () => {
    const client = createGateClient({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test" });
    expect(typeof client.passkeys.register.begin).toBe("function");
    expect(typeof client.passkeys.register.finish).toBe("function");
    expect(typeof client.passkeys.signIn.begin).toBe("function");
    expect(typeof client.passkeys.signIn.finish).toBe("function");
    expect(typeof client.mfa.totp.enroll).toBe("function");
    expect(typeof client.mfa.totp.confirm).toBe("function");
    expect(typeof client.mfa.methods.list).toBe("function");
    expect(typeof client.mfa.methods.delete).toBe("function");
    expect(typeof client.passwordReset.request).toBe("function");
    expect(typeof client.passwordReset.redeem).toBe("function");
    expect(typeof client.invitations.redeem).toBe("function");
    expect(typeof client.verifySession).toBe("function");
  });
});
