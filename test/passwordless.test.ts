/**
 * `gate.passwordless.*` sub-namespace tests: OTP and Magic
 * Link client-side surface.
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

describe("gate.passwordless.requestOtp", () => {
  it("POSTs to /@<slug>/gate/otp/request with email body + returns the otp id and expiry", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { otp: { id: "euoc_1", expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.passwordless.requestOtp({ email: "user@example.com" });
    expect(envelope.data.otp.id).toBe("euoc_1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/otp/request",
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ email: "user@example.com" });
  });

  it("forwards the optional purpose (gateway-validated union)", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { otp: { id: "euoc_1", expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    await gate.passwordless.requestOtp({
      email: "user@example.com",
      purpose: "password_reset",
    });
    expect(calls[0]?.body).toEqual({
      email: "user@example.com",
      purpose: "password_reset",
    });
  });
});

describe("gate.passwordless.parseMagicLinkCallback", () => {
  it("extracts the opaque token from the landing-page query string", () => {
    expect(gate.passwordless.parseMagicLinkCallback("?token=abc123&project=proj_x")).toEqual({
      ok: true,
      token: "abc123",
    });
  });

  it("works without the leading '?'", () => {
    expect(gate.passwordless.parseMagicLinkCallback("token=xyz")).toEqual({ ok: true, token: "xyz" });
  });

  it("returns ok:false when the token is absent", () => {
    expect(gate.passwordless.parseMagicLinkCallback("?project=proj_x")).toEqual({
      ok: false,
      error: "missing_token",
    });
  });

  it("surfaces an explicit error param", () => {
    expect(gate.passwordless.parseMagicLinkCallback("?error=link_expired")).toEqual({
      ok: false,
      error: "link_expired",
    });
  });
});

describe("gate.passwordless.verifyOtp", () => {
  it("POSTs email + code; returns the session and endUserId on success", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, {
        data: {
          verified: true,
          endUserId: "eu_user1",
          session: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: "2026-05-13T03:00:00Z",
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
    const envelope = await gate.passwordless.verifyOtp({
      email: "user@example.com",
      code: "123456",
    });
    expect(envelope.data.verified).toBe(true);
    expect(envelope.data.endUserId).toBe("eu_user1");
    expect(envelope.data.session?.accessToken).toBe("access-1");
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/otp/verify",
    );
    expect(calls[0]?.body).toEqual({ email: "user@example.com", code: "123456" });
  });

  it("INVALID_CREDENTIALS on wrong/expired OTP propagates as GateError 401", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(401, {
        code: "K9O_INVALID_CREDENTIALS",
        message: "OTP is incorrect or expired",
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: GateError | null = null;
    try {
      await gate.passwordless.verifyOtp({ email: "user@example.com", code: "999999" });
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect(caught?.code).toBe("INVALID_CREDENTIALS");
    expect(caught?.status).toBe(401);
  });
});

describe("gate.passwordless.requestMagicLink", () => {
  it("POSTs email + optional redirectUrl; returns { magicLink }", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { magicLink: { sent: true, expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.passwordless.requestMagicLink({
      email: "user@example.com",
      redirectUrl: "https://customer-app.com/auth/callback",
    });
    expect(envelope.data.magicLink.sent).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/magic-link/send",
    );
    expect(calls[0]?.body).toEqual({
      email: "user@example.com",
      redirectUrl: "https://customer-app.com/auth/callback",
    });
  });

  it("works without redirectUrl (uses project's default)", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { magicLink: { sent: true, expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    await gate.passwordless.requestMagicLink({ email: "user@example.com" });
    expect(calls[0]?.body).toEqual({ email: "user@example.com" });
  });
});

describe("gate.passwordless.verifyMagicLink", () => {
  it("POSTs token; returns the session and endUserId on success", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, {
        data: {
          redeemed: true,
          endUserId: "eu_user1",
          session: {
            accessToken: "access-ml",
            refreshToken: "refresh-ml",
            expiresAt: "2026-05-13T03:00:00Z",
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
    const envelope = await gate.passwordless.verifyMagicLink({
      token: "magic-link-opaque-token-xyz",
    });
    expect(envelope.data.redeemed).toBe(true);
    expect(envelope.data.session.accessToken).toBe("access-ml");
    expect(calls[0]?.url).toBe(
      "https://api.example.test/@member-portal/gate/magic-link/redeem",
    );
    expect(calls[0]?.body).toEqual({ token: "magic-link-opaque-token-xyz" });
  });

  it("INVALID_CREDENTIALS on expired/wrong token propagates as GateError 401", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(401, {
        code: "K9O_INVALID_CREDENTIALS",
        message: "Magic link token is invalid or has expired",
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: GateError | null = null;
    try {
      await gate.passwordless.verifyMagicLink({ token: "expired-token" });
    } catch (e) {
      caught = e as GateError;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect(caught?.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("gate.passwordless — mode-header routing (composes with marquee gate.* + client.ts)", () => {
  it("standalone-mode requests carry x-gate-mode: standalone header", async () => {
    let modeHeader = "";
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: ((_url: string, init?: RequestInit) => {
        modeHeader = (init?.headers as Record<string, string>)["x-gate-mode"] ?? "";
        return Promise.resolve(jsonResponse(200, { data: { magicLink: { sent: true, expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await gate.passwordless.requestOtp({ email: "u@e.com" });
    expect(modeHeader).toBe("standalone");
  });

  it("native-mode requests carry x-gate-mode: native header", async () => {
    let modeHeader = "";
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: ((_url: string, init?: RequestInit) => {
        modeHeader = (init?.headers as Record<string, string>)["x-gate-mode"] ?? "";
        return Promise.resolve(jsonResponse(200, { data: { magicLink: { sent: true, expiresAt: "2026-05-13T03:00:00Z" } }, meta: {} }));
      }) as unknown as typeof fetch,
    });
    await gate.passwordless.requestOtp({ email: "u@e.com" });
    expect(modeHeader).toBe("native");
  });
});
