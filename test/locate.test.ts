/**
 * The locate door: the credential flows ask the project which region holds the address, and send the credential only to
 * an origin that passes the rule in `locate.ts`.
 */
import { describe, expect, it } from "bun:test";
import { createGateClient } from "../src/client-factory.ts";
import { chooseLocatedOrigin } from "../src/locate.ts";

const BASE = "https://acme.api-de01.example.test";

describe("chooseLocatedOrigin", () => {
  const ok: Array<[string, string, unknown]> = [
    ["a sibling region of the same org, family and apex", "https://acme.api-us01.example.test", { region: "us01", origin: "https://acme.api-us01.example.test" }],
    ["the base's own region", BASE, { region: "de01", origin: BASE }],
    ["a trailing slash", "https://acme.api-us01.example.test", { region: "us01", origin: "https://acme.api-us01.example.test/" }],
  ];
  for (const [name, want, answer] of ok) it(`uses ${name}`, () => expect(chooseLocatedOrigin(BASE, answer)).toBe(want));

  const refused: Array<[string, unknown]> = [
    ["null origin (single host, self-hosted)", { region: "de01", origin: null }],
    ["a missing answer", null],
    ["http", { region: "us01", origin: "http://acme.api-us01.example.test" }],
    ["userinfo", { region: "us01", origin: "https://u:p@acme.api-us01.example.test" }],
    ["a port", { region: "us01", origin: "https://acme.api-us01.example.test:8443" }],
    ["a path", { region: "us01", origin: "https://acme.api-us01.example.test/x" }],
    ["a query", { region: "us01", origin: "https://acme.api-us01.example.test/?a=1" }],
    ["an empty query", { region: "us01", origin: "https://acme.api-us01.example.test/?" }],
    ["an empty fragment", { region: "us01", origin: "https://acme.api-us01.example.test/#" }],
    ["another org", { region: "us01", origin: "https://evil.api-us01.example.test" }],
    ["another apex", { region: "us01", origin: "https://acme.api-us01.evil.io" }],
    ["another family", { region: "us01", origin: "https://acme.api-staging-us01.example.test" }],
    ["a code that differs from region", { region: "us01", origin: "https://acme.api-fr01.example.test" }],
    ["a region that is not a code", { region: "usa", origin: "https://acme.api-usa.example.test" }],
    ["a host with no region", { region: "us01", origin: "https://acme.api.example.test" }],
    ["a region as a subdomain", { region: "us01", origin: "https://us01.acme.api-de01.example.test" }],
    ["a look-alike apex", { region: "us01", origin: "https://acme.api-us01.example.test.evil.io" }],
  ];
  for (const [name, answer] of refused) it(`falls back to the base for ${name}`, () => expect(chooseLocatedOrigin(BASE, answer)).toBe(BASE));

  it("allows http only when the base is http on loopback, and then only the same host", () => {
    expect(chooseLocatedOrigin("http://localhost:8080", { region: "de01", origin: "http://localhost:8080" })).toBe("http://localhost:8080");
    expect(chooseLocatedOrigin("http://localhost:8080", { region: "de01", origin: "http://evil.localhost:8080" })).toBe("http://localhost:8080");
    expect(chooseLocatedOrigin("https://localhost", { region: "de01", origin: "http://localhost" })).toBe("https://localhost");
  });

  it("uses the base when the base is not a gateway host shape", () => {
    expect(chooseLocatedOrigin("https://gw.internal.example", { region: "us01", origin: "https://gw-us01.internal.example" })).toBe("https://gw.internal.example");
  });
});

type Seen = { method: string; url: string; body: unknown; headers: Record<string, string> };

function harness(answer: (u: string) => Response) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    return answer(url);
  }) as unknown as typeof globalThis.fetch;
  return { seen, client: createGateClient({ mode: "standalone", baseUrl: BASE, projectSlug: "portal", fetch }) };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NF = { code: "K9O_NOT_FOUND", message: "x", context: {}, recommendation: null };
const session = { accessToken: "a", refreshToken: "r-1", expiresAt: "x", refreshExpiresAt: "x" };
const authResult = { user: { id: "eu_1" }, session };

describe("password sign-in through the locate door", () => {
  it("sends only the email to the door, then the password to the located origin", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "us01", origin: "https://acme.api-us01.example.test" }, meta: {} }) : json(200, { data: authResult, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    expect(h.seen.map((s) => s.url)).toEqual([`${BASE}/@portal/gate/locate`, "https://acme.api-us01.example.test/@portal/gate/signin"]);
    expect(h.seen[0]!.body).toEqual({ email: "a@b.co" });
    expect(h.seen[0]!.headers["authorization"]).toBeUndefined();
  });

  it("never sends the password to an origin that fails the rule", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "us01", origin: "https://evil.example" }, meta: {} }) : json(200, { data: authResult, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    expect(h.seen[1]!.url).toBe(`${BASE}/@portal/gate/signin`);
    expect(h.seen.some((s) => s.url.includes("evil.example"))).toBe(false);
  });

  it("uses the base when the door answers origin null", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "de01", origin: null }, meta: {} }) : json(200, { data: authResult, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    expect(h.seen[1]!.url).toBe(`${BASE}/@portal/gate/signin`);
  });

  it("sends nothing to sign-in when the door is down (503) or rate-limited (429), and raises the door's error", async () => {
    for (const [status, code] of [[503, "K9O_GATE_REGION_UNAVAILABLE"], [429, "K9O_RATE_LIMITED"]] as const) {
      const h = harness(() => json(status, { code, message: "x", context: {}, recommendation: null }));
      await expect(h.client.signIn({ email: "a@b.co", password: "pw" })).rejects.toMatchObject({ code: code.replace(/^K9O_/, "") });
      expect(h.seen).toHaveLength(1);
    }
  });

  it("uses the base when the door answers 404, and the call succeeds", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(404, NF) : json(200, { data: authResult, meta: {} })));
    const out = await h.client.signIn({ email: "a@b.co", password: "pw" });
    expect(out.data.user.id).toBe("eu_1");
    expect(h.seen.map((s) => s.url)).toEqual([`${BASE}/@portal/gate/locate`, `${BASE}/@portal/gate/signin`]);
  });

  it("raises when the door answers 404 and then sign-in itself answers 404", async () => {
    const h = harness(() => json(404, NF));
    await expect(h.client.signIn({ email: "a@b.co", password: "pw" })).rejects.toMatchObject({ status: 404 });
    expect(h.seen.map((s) => s.url)).toEqual([`${BASE}/@portal/gate/locate`, `${BASE}/@portal/gate/signin`]);
  });

  it("moves the origin hint to the rotated refresh token", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "us01", origin: "https://acme.api-us01.example.test" }, meta: {} }) : json(200, { data: u.endsWith("/signin") ? authResult : { accessToken: "a2", refreshToken: "r-2", expiresAt: "x" }, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    await h.client.refreshToken({ refreshToken: "r-1" });
    await h.client.refreshToken({ refreshToken: "r-2" });
    const refreshes = h.seen.map((s) => s.url).filter((u) => u.endsWith("/gate/refresh"));
    expect(refreshes).toEqual(["https://acme.api-us01.example.test/@portal/gate/refresh", "https://acme.api-us01.example.test/@portal/gate/refresh"]);
    await h.client.refreshToken({ refreshToken: "r-1" });
    expect(h.seen[h.seen.length - 1]!.url).toBe(`${BASE}/@portal/gate/refresh`);
  });

  it("does not cache the located origin: the next sign-in asks again", async () => {
    let n = 0;
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: n++ === 0 ? "us01" : "fr01", origin: n === 1 ? "https://acme.api-us01.example.test" : "https://acme.api-fr01.example.test" }, meta: {} }) : json(200, { data: authResult, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    expect(h.seen.filter((s) => s.url.endsWith("/gate/locate"))).toHaveLength(2);
    expect(h.seen.map((s) => s.url).filter((u) => u.endsWith("/signin"))).toEqual(["https://acme.api-us01.example.test/@portal/gate/signin", "https://acme.api-fr01.example.test/@portal/gate/signin"]);
  });

  it("sends refresh and sign-out to the origin that issued the session", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "us01", origin: "https://acme.api-us01.example.test" }, meta: {} }) : json(200, { data: u.endsWith("/signin") ? authResult : { revoked: true }, meta: {} })));
    await h.client.signIn({ email: "a@b.co", password: "pw" });
    await h.client.refreshToken({ refreshToken: "r-1" });
    await h.client.signOut({ refreshToken: "r-1" });
    const urls = h.seen.map((s) => s.url);
    expect(urls).toContain("https://acme.api-us01.example.test/@portal/gate/refresh");
    expect(urls).toContain("https://acme.api-us01.example.test/@portal/gate/signout");
    await h.client.refreshToken({ refreshToken: "r-1" });
    expect(h.seen[h.seen.length - 1]!.url).toBe(`${BASE}/@portal/gate/refresh`);
  });
});

describe("the other identifier-first flows", () => {
  it("locate first for OTP request, OTP verify and magic-link send, with the email only", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(200, { data: { region: "de01", origin: null }, meta: {} }) : json(200, { data: { otp: { id: "o", expiresAt: "x" }, magicLink: { sent: true }, verified: true }, meta: {} })));
    await h.client.passwordless.requestOtp({ email: "a@b.co" });
    await h.client.passwordless.verifyOtp({ email: "a@b.co", code: "123456" });
    await h.client.passwordless.requestMagicLink({ email: "a@b.co" });
    expect(h.seen.map((s) => s.url.replace(BASE, ""))).toEqual([
      "/@portal/gate/locate", "/@portal/gate/otp/request",
      "/@portal/gate/locate", "/@portal/gate/otp/verify",
      "/@portal/gate/locate", "/@portal/gate/magic-link/send",
    ]);
    expect(h.seen.filter((s) => s.url.endsWith("/locate")).every((s) => JSON.stringify(s.body) === '{"email":"a@b.co"}')).toBe(true);
  });

  it("a 404 from the door means the base for OTP request, OTP verify and magic-link send", async () => {
    const h = harness((u) => (u.endsWith("/gate/locate") ? json(404, NF) : json(200, { data: { otp: { id: "o", expiresAt: "x" }, magicLink: { sent: true }, verified: true }, meta: {} })));
    await h.client.passwordless.requestOtp({ email: "a@b.co" });
    await h.client.passwordless.verifyOtp({ email: "a@b.co", code: "123456" });
    await h.client.passwordless.requestMagicLink({ email: "a@b.co" });
    expect(h.seen.filter((s) => !s.url.endsWith("/locate")).map((s) => s.url)).toEqual([`${BASE}/@portal/gate/otp/request`, `${BASE}/@portal/gate/otp/verify`, `${BASE}/@portal/gate/magic-link/send`]);
  });

  it("door 429 and 503 still raise for every flow, with no credential request", async () => {
    for (const [status, code] of [[503, "K9O_GATE_REGION_UNAVAILABLE"], [429, "K9O_RATE_LIMITED"]] as const) {
      const h = harness(() => json(status, { code, message: "x", context: {}, recommendation: null }));
      const want = { code: code.replace(/^K9O_/, "") };
      await expect(h.client.passwordless.requestOtp({ email: "a@b.co" })).rejects.toMatchObject(want);
      await expect(h.client.passwordless.verifyOtp({ email: "a@b.co", code: "123456" })).rejects.toMatchObject(want);
      await expect(h.client.passwordless.requestMagicLink({ email: "a@b.co" })).rejects.toMatchObject(want);
      expect(h.seen.every((s) => s.url.endsWith("/locate"))).toBe(true);
    }
  });

  it("raises when the door answers 404 and then the OTP request answers 404", async () => {
    const h = harness(() => json(404, NF));
    await expect(h.client.passwordless.requestOtp({ email: "a@b.co" })).rejects.toMatchObject({ status: 404 });
    expect(h.seen).toHaveLength(2);
  });

  it("sign-up, whoami and the IdP calls do not use the door", async () => {
    const h = harness(() => json(200, { data: authResult, meta: {} }));
    await h.client.signUp({ email: "a@b.co", password: "pw-long-enough-1" });
    await h.client.whoami();
    expect(h.seen.some((s) => s.url.endsWith("/locate"))).toBe(false);
  });
});
