/**
 * The public @k9o/gate surface, one entry per method that has a route: how to call it with representative arguments. The
 * contract test sends each call through the recording client and checks the request against the gateway OpenAPI.
 * `broken` marks a call known to disagree with the gateway; the test requires it to still fail, so the list can only shrink.
 */
import type { BodySchema } from "../../../core/test/contract/openapi.ts";

// biome-ignore lint/suspicious/noExplicitAny: the table exercises every namespace
export type Client = any;

export type CallEntry = {
  id: string;
  call: (c: Client) => Promise<unknown>;
  /** Body contract for a route whose OpenAPI entry declares none. */
  contract?: BodySchema;
  broken?: string;
};

/** `gate.signInWithProvider` redirects the browser; the table gives it a window to assign. */
function withWindow<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { window?: unknown };
  g.window = { location: { assign: () => {} } };
  return fn().finally(() => {
    delete g.window;
  });
}

/** An in-memory stand-in for `sessionStorage`. */
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

export const CALLS: CallEntry[] = [
  { id: "gate.signUp", call: (c) => c.signUp({ email: "a@b.co", password: "correct-horse-battery", displayName: "A" }) },
  { id: "gate.signIn", call: (c) => c.signIn({ email: "a@b.co", password: "pw" }) },
  { id: "gate.signOut", call: (c) => c.signOut({ refreshToken: "refresh-token-1" }) },
  { id: "gate.whoami", call: (c) => c.whoami() },
  { id: "gate.revokeAllSessions", call: (c) => c.revokeAllSessions() },
  { id: "gate.refreshToken", call: (c) => c.refreshToken({ refreshToken: "refresh-token-1" }) },
  {
    id: "gate.signInWithProvider",
    call: (c) => withWindow(() => c.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/cb", storage: memoryStorage() })),
  },
  {
    id: "gate.completeSignIn",
    call: async (c) => {
      const storage = memoryStorage();
      storage.setItem("k9o.gate.signin", JSON.stringify({ verifier: "v".repeat(43), redirectUri: "https://app.example.com/cb" }));
      return c.completeSignIn("#code=opaque-code", { storage });
    },
  },
  { id: "gate.passwordless.requestOtp", call: (c) => c.passwordless.requestOtp({ email: "a@b.co", purpose: "signin" }) },
  { id: "gate.passwordless.verifyOtp", call: (c) => c.passwordless.verifyOtp({ email: "a@b.co", code: "123456" }) },
  { id: "gate.passwordless.requestMagicLink", call: (c) => c.passwordless.requestMagicLink({ email: "a@b.co", redirectUrl: "https://app.example.com/ml" }) },
  { id: "gate.passwordless.verifyMagicLink", call: (c) => c.passwordless.verifyMagicLink({ token: "magic-link-token-0123456789" }) },
  { id: "gate.passkeys.register.begin", call: (c) => c.passkeys.register.begin() },
  { id: "gate.passkeys.register.finish", call: (c) => c.passkeys.register.finish({ response: { id: "cred1", response: { clientDataJSON: "abc" } }, label: "Laptop" }) },
  { id: "gate.passkeys.signIn.begin", call: (c) => c.passkeys.signIn.begin({ email: "a@b.co" }) },
  { id: "gate.passkeys.signIn.finish", call: (c) => c.passkeys.signIn.finish({ response: { id: "cred1", response: { signature: "sig" } } }) },
  { id: "gate.mfa.totp.enroll", call: (c) => c.mfa.totp.enroll({ label: "Phone" }) },
  { id: "gate.mfa.totp.confirm", call: (c) => c.mfa.totp.confirm({ factorId: "eumf_1", code: "123456", currentCode: "654321" }) },
  { id: "gate.mfa.methods.list", call: (c) => c.mfa.methods.list() },
  { id: "gate.mfa.methods.delete", call: (c) => c.mfa.methods.delete("eumf_1", { code: "123456" }) },
  { id: "gate.passwordReset.request", call: (c) => c.passwordReset.request({ email: "a@b.co" }) },
  { id: "gate.passwordReset.redeem", call: (c) => c.passwordReset.redeem({ token: "t".repeat(32), newPassword: "correct-horse-battery" }) },
  { id: "gate.invitations.redeem", call: (c) => c.invitations.redeem({ token: "t".repeat(32), password: "correct-horse-battery", displayName: "A" }) },
  { id: "gate.verifySession", call: (c) => c.verifySession({ token: "end-user-access-token" }) },
  { id: "gate.identityProviders.list", call: (c) => c.identityProviders.list() },
  {
    id: "gate.identityProviders.create",
    call: (c) =>
      c.identityProviders.create({ idpProvider: "google", displayName: "Google", clientId: "cid", clientSecretRef: "secret", redirectUri: "https://app.example.com/cb", tierGating: "free_tier_ok" }),
  },
  { id: "gate.identityProviders.update", call: (c) => c.identityProviders.update("epc_1", { enabled: true }) },
  { id: "gate.identityProviders.testProvider", call: (c) => c.identityProviders.testProvider("epc_1") },
  { id: "gate.magicLinkRedirects.list", call: (c) => c.magicLinkRedirects.list() },
  { id: "gate.magicLinkRedirects.add", call: (c) => c.magicLinkRedirects.add({ redirectUrl: "https://app.example.com/ml", isDefault: true }) },
  { id: "gate.magicLinkRedirects.setDefault", call: (c) => c.magicLinkRedirects.setDefault("mlr_1") },
  { id: "gate.magicLinkRedirects.remove", call: (c) => c.magicLinkRedirects.remove("mlr_1") },
];
