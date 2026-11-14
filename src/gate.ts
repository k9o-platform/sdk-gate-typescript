/**
 * The `gate.*` namespace, bound to the end-user Gate routes (project-scoped, `<org>.api.<apex>/@<projectSlug>/gate/...`):
 *   - `gate.signUp` POST /gate/signup
 *   - `gate.signIn` POST /gate/signin
 *   - `gate.signOut` POST /gate/signout
 *   - `gate.whoami` GET /gate/whoami
 *   - `gate.revokeAllSessions` POST /auth/sessions/revoke-all
 *   - `gate.refreshToken` POST /gate/refresh
 *   - `gate.signInWithProvider` POST /gate/idp/{provider}/authorize
 *   - `gate.completeSignIn` POST /gate/idp/exchange
 *   - `gate.passwordless.*` POST /gate/otp/{request,verify} and /gate/magic-link/{send,redeem}
 *   - `gate.passkeys.{register,signIn}.{begin,finish}` POST /gate/passkeys/{register,signin}/{begin,finish}
 *   - `gate.mfa.totp.{enroll,confirm}` POST /gate/mfa/totp/{enroll,confirm}
 *   - `gate.mfa.methods.list` GET /gate/mfa/methods, `gate.mfa.methods.delete` DELETE /gate/mfa/methods/{methodId}
 *   - `gate.passwordReset.{request,redeem}` POST /gate/password-reset/{request,redeem}
 *   - `gate.invitations.redeem` POST /gate/invitations/redeem
 *   - `gate.verifySession` POST /gate/verify-session
 *
 * Every function returns the standard envelope `{ data, meta }` and throws a `GateError` on a non-2xx gateway answer.
 * The mode (native or standalone) does not change the call shapes; the client sends it as the `X-Gate-Mode` header.
 */

import { getGateConfig, type GateConfig } from "./mode.ts";
import { requestWith } from "./client.ts";
import { GateError } from "./errors.ts";
import { resolveProjectPathRoot } from "./paths.ts";
import { makeIdentityProviders } from "./idp-providers/identity-providers.ts";
import { makeMagicLinkRedirects } from "./magic-link-redirects.ts";
import { forgetSessionOrigin, locateOrigin, rememberSessionOrigin, sessionOriginHint } from "./locate.ts";
import type {
  AuthResult,
  BearerOptions,
  BeginPasskeySignInInput,
  ConfirmTotpInput,
  ConfirmTotpResult,
  ListMfaMethodsResult,
  DeleteMfaMethodInput,
  DeleteMfaMethodResult,
  EnrollTotpInput,
  EnrollTotpResult,
  Envelope,
  FinishPasskeyRegistrationInput,
  FinishPasskeyRegistrationResult,
  FinishPasskeySignInInput,
  FinishPasskeySignInResult,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
  RedeemInvitationInput,
  RedeemInvitationResult,
  RedeemPasswordResetInput,
  RedeemPasswordResetResult,
  RequestPasswordResetInput,
  RequestPasswordResetResult,
  VerifySessionInput,
  VerifySessionResult,
  MagicLinkCallbackResult,
  RefreshResult,
  RefreshTokenInput,
  RequestMagicLinkResult,
  RequestOtpResult,
  RequestMagicLinkInput,
  RequestOtpInput,
  SignInCallbackResult,
  SignInInput,
  SignInStorage,
  SignOutInput,
  SignOutResult,
  RevokeAllSessionsResult,
  SignUpInput,
  VerifyMagicLinkInput,
  VerifyMagicLinkResult,
  VerifyOtpInput,
  VerifyOtpResult,
  WhoamiResult,
} from "./types.ts";

const VERIFIER_KEY = "k9o.gate.signin";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url: 43 characters. */
function randomVerifier(): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

async function s256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function pickStorage(given: SignInStorage | undefined): SignInStorage {
  if (given !== undefined) return given;
  const s = (globalThis as { sessionStorage?: SignInStorage }).sessionStorage;
  if (s === undefined) {
    throw new Error("Provider sign-in needs somewhere to keep its verifier: pass `storage` outside a browser.");
  }
  return s;
}

function readVerifier(storage: SignInStorage): { verifier: string; redirectUri: string } | null {
  const raw = storage.getItem(VERIFIER_KEY);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as { verifier?: unknown; redirectUri?: unknown };
    return typeof v.verifier === "string" && typeof v.redirectUri === "string"
      ? { verifier: v.verifier, redirectUri: v.redirectUri }
      : null;
  } catch {
    return null;
  }
}

function gatePath(config: GateConfig, suffix: string): string {
  return `${resolveProjectPathRoot(config)}/gate/${suffix}`;
}

/** Factory — produces a `gate.*` namespace bound to the supplied config getter.
 *  Used by both the module-level `gate` singleton (config from `configureGate`)
 *  and `createGateClient(config)` (config supplied at construction time). */
export function makeGateNamespace(getConfig: () => GateConfig) {
  return {
  /**
   * Create a new end-user for the configured project. Returns the new user and an initial session. The body is
   * closed: `{ email, password, displayName? }`.
   *
   * Errors:
   *   - `EMAIL_ALREADY_REGISTERED` (409) when the email collides
   *   - `INVALID_FIELD_VALUE` (400) on a schema violation (password policy, malformed email, unknown field)
   *   - `TIER_FEATURE_GATED` (403) when the project's tier blocks email/password
   */
  async signUp(input: SignUpInput): Promise<Envelope<AuthResult>> {
    return requestWith<AuthResult>(getConfig(), {
      method: "POST",
      path: gatePath(getConfig(), "signup"),
      body: input,
    });
  },

  /**
   * Sign in an existing end-user with email and password. Returns the user and a fresh session.
   *
   * Errors:
   *   - `INVALID_CREDENTIALS` (401) on a bad email or password (the same answer for both, on purpose)
   */
  async signIn(input: SignInInput): Promise<Envelope<AuthResult>> {
    const origin = await locateOrigin(getConfig(), input.email);
    const out = await requestWith<AuthResult>(getConfig(), {
      method: "POST",
      path: gatePath(getConfig(), "signin"),
      body: input,
      origin,
    });
    rememberSessionOrigin(out.data?.session?.refreshToken, origin);
    return out;
  },

  /**
   * Sign out: revoke the session that the given refresh token belongs to. The route needs the refresh token in the
   * body, so it is required here. Revoking an unknown or already-revoked token also answers `{ revoked: false }`.
   */
  async signOut(input: SignOutInput): Promise<Envelope<SignOutResult>> {
    const origin = sessionOriginHint(input.refreshToken);
    const out = await requestWith<SignOutResult>(getConfig(), {
      method: "POST",
      path: gatePath(getConfig(), "signout"),
      body: input,
      ...(origin !== undefined ? { origin } : {}),
    });
    forgetSessionOrigin(input.refreshToken);
    return out;
  },

  /**
   * End every live session of the signed-in end user, on every device and this one (`POST /@<projectSlug>/auth/sessions/revoke-all`).
   * Call it with the user's access token as the bearer, not a refresh token. The answer is `{ revokedCount }`, the number
   * of sessions ended. Each ended session's next refresh is refused with `SESSION_EXPIRED` and `context.reason` of
   * `revoked`. Access tokens already issued keep working until they expire, so drop yours after the call and discard the
   * stored refresh token.
   *
   * Errors:
   *   - `UNAUTHENTICATED` (401) when no bearer is present
   *   - `K9O_TRUST_ZONE_VIOLATION` (403) when the token is an operator's, not an end user's
   *   - `K9O_PROJECT_SCOPE_MISMATCH` (403) when the token's audience is another project (these two codes keep their `K9O_` prefix)
   */
  async revokeAllSessions(): Promise<Envelope<RevokeAllSessionsResult>> {
    return requestWith<RevokeAllSessionsResult>(getConfig(), {
      method: "POST",
      path: `${resolveProjectPathRoot(getConfig())}/auth/sessions/revoke-all`,
    });
  },

  /**
   * Return the signed-in end-user (the bearer token's subject). The answer is the user record itself, not wrapped.
   *
   * Errors:
   *   - `UNAUTHENTICATED` (401) when no bearer is present
   *   - `SESSION_EXPIRED` (401) when the bearer has expired or was revoked
   */
  async whoami(): Promise<Envelope<WhoamiResult>> {
    return requestWith<WhoamiResult>(getConfig(), {
      method: "GET",
      path: gatePath(getConfig(), "whoami"),
    });
  },

  /**
   * Exchange a refresh token for a new access token. The answer carries the new `accessToken`, its `expiresAt`
   * and a new `refreshToken`. The refresh token you sent stops working, so store the new one before you refresh
   * again, and refresh one at a time per session: a second refresh with a token already used is a replay, and a
   * replay ends the session.
   *
   * Errors:
   *   - `INVALID_CREDENTIALS` (401) when the refresh token is unknown or its user is locked
   *   - `SESSION_EXPIRED` (401) when the session has ended. `context.reason` is `inactive`, `max_length`,
   *     `revoked` or `replay` (a used token was sent again). The user signs in again. Under `errors: "redacted"`
   *     the context is dropped, so the reason is not available.
   */
  async refreshToken(input: RefreshTokenInput): Promise<Envelope<RefreshResult>> {
    const origin = sessionOriginHint(input.refreshToken);
    const out = await requestWith<RefreshResult>(getConfig(), {
      method: "POST",
      path: gatePath(getConfig(), "refresh"),
      body: input,
      ...(origin !== undefined ? { origin } : {}),
    });
    const next = out.data?.refreshToken;
    if (origin !== undefined && typeof next === "string" && next.length > 0 && next !== input.refreshToken) {
      forgetSessionOrigin(input.refreshToken);
      rememberSessionOrigin(next, origin);
    }
    return out;
  },

  /**
   * Start a sign-in with an external identity provider (Google, GitHub, Microsoft, OIDC or SAML).
   * The SDK makes a one-time verifier, keeps it in the page's storage (`sessionStorage` unless you pass `storage`),
   * sends only its SHA-256 challenge to the authorize route, and sends the browser to the provider.
   *
   * The provider sends the browser back to `redirectUri#code=<code>`. The code grants nothing alone: call
   * `completeSignIn()` on that page to exchange it, with the stored verifier, for the session.
   *
   * Example:
   *   await gate.signInWithProvider({
   *     provider: 'google',
   *     redirectUri: 'https://app.example.com/auth/callback',
   *   });
   */
  async signInWithProvider(input: {
    provider: "google" | "github" | "microsoft" | "apple" | "facebook" | "twitter" | "oidc" | "saml";
    redirectUri: string;
    /** Where the verifier is kept between the two pages. Defaults to `sessionStorage`. */
    storage?: SignInStorage;
  }): Promise<void> {
    const w = (globalThis as { window?: { location: { assign: (url: string) => void } } }).window;
    if (w === undefined) {
      throw new Error(
        "signInWithProvider requires a browser environment (window.location); for server-side initiation, fetch the authorize endpoint directly.",
      );
    }
    const storage = pickStorage(input.storage);
    const verifier = randomVerifier();
    const codeChallenge = await s256(verifier);
    const env = await requestWith<{ authorizationUrl: string }>(getConfig(), {
      method: "POST",
      path: `${resolveProjectPathRoot(getConfig())}/gate/idp/${input.provider}/authorize`,
      body: { redirectUri: input.redirectUri, codeChallenge, codeChallengeMethod: "S256" },
      anonymous: true,
    });
    storage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, redirectUri: input.redirectUri }));
    w.location.assign(env.data.authorizationUrl);
  },

  /**
   * Finish a provider sign-in on the page the provider sent the browser back to. Reads `#code=` from the URL
   * fragment (`location.hash` unless you pass `hash`), removes the fragment from the address bar, and exchanges the
   * code with the verifier `signInWithProvider` stored (`POST /@<projectSlug>/gate/idp/exchange`). The stored
   * verifier is cleared whatever the outcome. Persisting the returned tokens is up to you.
   *
   * A failure comes back as `{ ok: false, error }`: the provider's own subcode from `#error=`, `malformed_callback`
   * (no code in the fragment), `verifier_missing` (this page has no stored verifier: another tab, or cleared
   * storage; start the sign-in again), or the gateway's reason (`idp_code_invalid`, `idp_code_expired`,
   * `idp_code_used`, `idp_verifier_mismatch`).
   */
  async completeSignIn(
    hash?: string,
    options: { storage?: SignInStorage } = {},
  ): Promise<SignInCallbackResult> {
    const win = (globalThis as { window?: { location?: { hash?: string; pathname?: string; search?: string }; history?: { replaceState: (s: unknown, t: string, url: string) => void } } }).window;
    const fragment = hash ?? win?.location?.hash ?? "";
    const storage = pickStorage(options.storage);
    if (win?.history !== undefined && win.location !== undefined && fragment !== "") {
      try {
        win.history.replaceState(null, "", `${win.location.pathname ?? ""}${win.location.search ?? ""}`);
      } catch {
        // The address bar is cosmetic; the exchange does not depend on it.
      }
    }
    const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
    const stored = readVerifier(storage);
    storage.removeItem(VERIFIER_KEY);
    const error = params.get("error");
    if (error !== null) {
      return { ok: false, error, errorDescription: params.get("error_description") ?? error };
    }
    const code = params.get("code");
    if (code === null || code === "") {
      return {
        ok: false,
        error: "malformed_callback",
        errorDescription: "Callback URL fragment has no code.",
      };
    }
    if (stored === null) {
      return {
        ok: false,
        error: "verifier_missing",
        errorDescription: "No sign-in is waiting in this browser tab. Start the sign-in again.",
      };
    }
    try {
      const env = await requestWith<{ session: { accessToken: string; refreshToken: string; expiresAt: string } }>(getConfig(), {
        method: "POST",
        path: `${resolveProjectPathRoot(getConfig())}/gate/idp/exchange`,
        body: { code, codeVerifier: stored.verifier, redirectUri: stored.redirectUri },
        anonymous: true,
      });
      const { accessToken, refreshToken, expiresAt } = env.data.session;
      return { ok: true, accessToken, refreshToken, expiresAt, tokenType: "Bearer" };
    } catch (e) {
      if (e instanceof GateError && e.status !== null && e.status >= 400 && e.status < 500) {
        const reason = e.status === 429 ? "K9O_RATE_LIMITED" : typeof e.context.reason === "string" ? e.context.reason : e.code;
        return { ok: false, error: reason, errorDescription: e.message };
      }
      throw e;
    }
  },

  /**
   * Passwordless sign-in: one-time passcode and magic link, both by email.
   *
   * Routes: `POST /@<projectSlug>/gate/otp/{request,verify}` and `POST /@<projectSlug>/gate/magic-link/{send,redeem}`.
   * The method names do not mirror the last path segment (`requestMagicLink` calls `send`, `verifyMagicLink` calls
   * `redeem`).
   */
  passwordless: {
    /**
     * Request a one-time passcode for the email. It is short-lived and single-use; redeem it with `verifyOtp`.
     * The answer carries the code's id and expiry (`data.otp`); the code itself goes by email.
     */
    async requestOtp(input: RequestOtpInput): Promise<Envelope<RequestOtpResult>> {
      const origin = await locateOrigin(getConfig(), input.email);
      return requestWith<RequestOtpResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "otp/request"),
        body: input,
        origin,
      });
    },

    /**
     * Verify a one-time passcode previously sent via `requestOtp`. For the default `signin` purpose the answer
     * carries a fresh `session`; for any other purpose it only confirms (`verified: true`) and the caller continues
     * its own flow.
     *
     * Errors:
     *   - `INVALID_CREDENTIALS` (401) on a wrong, expired or used code
     */
    async verifyOtp(input: VerifyOtpInput): Promise<Envelope<VerifyOtpResult>> {
      const origin = await locateOrigin(getConfig(), input.email);
      const out = await requestWith<VerifyOtpResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "otp/verify"),
        body: input,
        origin,
      });
      rememberSessionOrigin(out.data?.session?.refreshToken, origin);
      return out;
    },

    /**
     * Request a magic link by email. The link carries an opaque short-lived token and lands at the project's
     * redirect URL with the token in the query string; exchange it with `verifyMagicLink`. The answer is
     * `data.magicLink` with `sent` and the expiry.
     */
    async requestMagicLink(input: RequestMagicLinkInput): Promise<Envelope<RequestMagicLinkResult>> {
      const origin = await locateOrigin(getConfig(), input.email);
      return requestWith<RequestMagicLinkResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "magic-link/send"),
        body: input,
        origin,
      });
    },

    /**
     * Redeem a magic-link token previously delivered via `requestMagicLink`. The answer carries the new `session`
     * and the `endUserId` (not the full user record; call `whoami` for that).
     *
     * Errors:
     *   - `INVALID_CREDENTIALS` (401) on a wrong, expired or used token
     */
    async verifyMagicLink(input: VerifyMagicLinkInput): Promise<Envelope<VerifyMagicLinkResult>> {
      return requestWith<VerifyMagicLinkResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "magic-link/redeem"),
        body: input,
      });
    },

  /**
     * Extract the opaque magic-link token from the landing-page URL's query
     * string (the gateway redirects to `<configured-redirect>?token=…&project=…`).
     * Pure + side-effect-free — pass `window.location.search`. Feed the
     * returned `token` to `verifyMagicLink({ token })` to mint the session.
     *
     * This is the magic-link counterpart to `completeSignIn` (which exchanges
     * the SSO *hash fragment* code for session tokens) — magic-link delivers an
     * opaque token in the *query string*, so the two are not interchangeable.
     */
    parseMagicLinkCallback(search: string): MagicLinkCallbackResult {
      const raw = search.startsWith("?") ? search.slice(1) : search;
      const params = new URLSearchParams(raw);
      const error = params.get("error");
      if (error !== null) {
        return { ok: false, error };
      }
      const token = params.get("token");
      if (token === null || token.length === 0) {
        return { ok: false, error: "missing_token" };
      }
      return { ok: true, token };
    },
  },

  /**
   * Passkeys (WebAuthn). These methods carry the options and credentials between your page or app and the gateway;
   * they do not call the browser's or the platform's passkey API. Hand `begin`'s options to that API and pass the
   * credential it makes to `finish`.
   *
   * Routes: `POST /@<projectSlug>/gate/passkeys/{register,signin}/{begin,finish}`.
   */
  passkeys: {
    register: {
      /**
       * Start adding a passkey to the signed-in end user (`POST /@<projectSlug>/gate/passkeys/register/begin`). Needs the
       * end user's access token as the bearer. The answer is the registration options (`data.challenge` and the rest);
       * the challenge is single-use and short-lived.
       */
      async begin(options: BearerOptions = {}): Promise<Envelope<PasskeyRegistrationOptions>> {
        return requestWith<PasskeyRegistrationOptions>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "passkeys/register/begin"),
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },

      /**
       * Finish adding a passkey (`POST /@<projectSlug>/gate/passkeys/register/finish`). Needs the end user's access
       * token as the bearer. Send the credential the authenticator made from `begin`'s options. The answer is
       * `data.passkey` with its `id` and `credentialId`.
       *
       * Errors:
       *   - `INVALID_FIELD_VALUE` (400) when the challenge is invalid, expired or already used, or the credential does
       *     not verify
       */
      async finish(
        input: FinishPasskeyRegistrationInput,
        options: BearerOptions = {},
      ): Promise<Envelope<FinishPasskeyRegistrationResult>> {
        return requestWith<FinishPasskeyRegistrationResult>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "passkeys/register/finish"),
          body: input,
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },
    },

    signIn: {
      /**
       * Start a passkey sign-in (`POST /@<projectSlug>/gate/passkeys/signin/begin`). No bearer token is sent. The answer
       * is the authentication options (`data.challenge` and the rest). Pass `email` to name the account, or omit it to
       * let the authenticator offer the passkeys it holds for this site.
       */
      async begin(input: BeginPasskeySignInInput = {}): Promise<Envelope<PasskeyAuthenticationOptions>> {
        return requestWith<PasskeyAuthenticationOptions>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "passkeys/signin/begin"),
          body: input,
          anonymous: true,
        });
      },

      /**
       * Finish a passkey sign-in (`POST /@<projectSlug>/gate/passkeys/signin/finish`). No bearer token is sent. Send the
       * assertion the authenticator made from `begin`'s options. The answer is `data.session`.
       *
       * Errors:
       *   - `INVALID_FIELD_VALUE` (400) when the challenge is invalid, expired or already used, the passkey is unknown,
       *     or the assertion does not verify
       */
      async finish(input: FinishPasskeySignInInput): Promise<Envelope<FinishPasskeySignInResult>> {
        return requestWith<FinishPasskeySignInResult>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "passkeys/signin/finish"),
          body: input,
          anonymous: true,
        });
      },
    },
  },

  /**
   * Second factors for the signed-in end user. Routes: `POST /@<projectSlug>/gate/mfa/totp/{enroll,confirm}`,
   * `GET /@<projectSlug>/gate/mfa/methods` and `DELETE /@<projectSlug>/gate/mfa/methods/{methodId}`. Every call needs
   * the end user's access token as the bearer.
   */
  mfa: {
    methods: {
      /**
       * List the signed-in end user's second factors (`GET /@<projectSlug>/gate/mfa/methods`), oldest first. The answer
       * is `data.methods`; a factor with `verifiedAt: null` is set up but not yet confirmed.
       */
      async list(options: BearerOptions = {}): Promise<Envelope<ListMfaMethodsResult>> {
        return requestWith<ListMfaMethodsResult>(getConfig(), {
          method: "GET",
          path: gatePath(getConfig(), "mfa/methods"),
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },

      /**
       * Remove one of the signed-in end user's second factors (`DELETE /@<projectSlug>/gate/mfa/methods/{methodId}`).
       * Removing a confirmed authenticator needs its current code in `input.code`; a factor that is still pending
       * needs none. The answer is `data.deleted`, `false` when no such factor belongs to the user.
       *
       * Errors:
       *   - `K9O_MFA_REQUIRED` (kept as the full wire code) when a confirmed authenticator is removed without `code`
       *   - `INVALID_CREDENTIALS` (401) on a wrong or expired code
       *   - `RATE_LIMITED` (429) after too many wrong codes
       */
      async delete(methodId: string, input: DeleteMfaMethodInput = {}, options: BearerOptions = {}): Promise<Envelope<DeleteMfaMethodResult>> {
        return requestWith<DeleteMfaMethodResult>(getConfig(), {
          method: "DELETE",
          path: gatePath(getConfig(), `mfa/methods/${encodeURIComponent(methodId)}`),
          ...(input.code !== undefined ? { body: { code: input.code } } : {}),
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },
    },

    totp: {
      /**
       * Start setting up an authenticator app (`POST /@<projectSlug>/gate/mfa/totp/enroll`). The answer is `data.factor`
       * with its `id`, the base32 `secret` and the `otpauth://` `uri` for a QR code. The secret is shown only in this
       * answer. The factor does nothing until `confirm` succeeds.
       */
      async enroll(input: EnrollTotpInput = {}, options: BearerOptions = {}): Promise<Envelope<EnrollTotpResult>> {
        return requestWith<EnrollTotpResult>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "mfa/totp/enroll"),
          body: input,
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },

      /**
       * Finish setting up an authenticator app with its first code (`POST /@<projectSlug>/gate/mfa/totp/confirm`). To add
       * a second authenticator, also pass `currentCode` from one already confirmed. When this is the person's first
       * confirmed authenticator, their other sessions are ended and the answer carries a new `session`.
       *
       * Errors:
       *   - `K9O_MFA_REQUIRED` (kept as the full wire code) when a second authenticator is added without `currentCode`
       *   - `INVALID_CREDENTIALS` (401) on a wrong or expired code
       */
      async confirm(input: ConfirmTotpInput, options: BearerOptions = {}): Promise<Envelope<ConfirmTotpResult>> {
        return requestWith<ConfirmTotpResult>(getConfig(), {
          method: "POST",
          path: gatePath(getConfig(), "mfa/totp/confirm"),
          body: input,
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
        });
      },
    },
  },

  /**
   * Password reset by email. Routes: `POST /@<projectSlug>/gate/password-reset/{request,redeem}`. No bearer token is
   * sent on either call.
   */
  passwordReset: {
    /**
     * Email a reset link to the address (`POST /@<projectSlug>/gate/password-reset/request`). The answer is the same
     * whether or not the address has an account, so it does not reveal which do. The token is valid for one hour and
     * works once. A deployment without a mail relay answers 503 `EMAIL_NOT_CONFIGURED`.
     */
    async request(input: RequestPasswordResetInput): Promise<Envelope<RequestPasswordResetResult>> {
      const origin = await locateOrigin(getConfig(), input.email);
      return requestWith<RequestPasswordResetResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "password-reset/request"),
        body: input,
        anonymous: true,
        origin,
      });
    },

    /**
     * Set a new password with the token from the email (`POST /@<projectSlug>/gate/password-reset/redeem`). The answer
     * carries a `session`, or, when the account has a confirmed authenticator, an `mfa` challenge and no session.
     *
     * Errors:
     *   - `INVALID_FIELD_VALUE` (400) on a wrong, expired or used token, or a password the project refuses
     */
    async redeem(input: RedeemPasswordResetInput): Promise<Envelope<RedeemPasswordResetResult>> {
      return requestWith<RedeemPasswordResetResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "password-reset/redeem"),
        body: input,
        anonymous: true,
      });
    },
  },

  /**
   * Invitations. An operator creates an invitation from the Console or the API; the invited person redeems it here.
   */
  invitations: {
    /**
     * Accept an invitation (`POST /@<projectSlug>/gate/invitations/redeem`). No bearer token is sent. The token from the
     * invitation and a password create the end user. The answer is `data.user` with its `id` and `email`, and a `session`.
     *
     * Errors:
     *   - `INVALID_FIELD_VALUE` (400) on a wrong, expired or used token, or a password the project refuses
     */
    async redeem(input: RedeemInvitationInput): Promise<Envelope<RedeemInvitationResult>> {
      return requestWith<RedeemInvitationResult>(getConfig(), {
        method: "POST",
        path: gatePath(getConfig(), "invitations/redeem"),
        body: input,
        anonymous: true,
      });
    },
  },

  /**
   * Check an end user's access token from your backend (`POST /@<projectSlug>/gate/verify-session`). The call itself is
   * authenticated with the bearer the client holds (`partnerToken`, or `bearerToken` here); the token to check goes in
   * the body. The answer is `{ valid: true, claims }`, or `{ valid: false, reason }` for an invalid or expired
   * token, a token for another project, or an end user who is no longer active. A refused token is an answer
   * with `valid: false`, not an error.
   */
  async verifySession(input: VerifySessionInput, options: BearerOptions = {}): Promise<Envelope<VerifySessionResult>> {
    return requestWith<VerifySessionResult>(getConfig(), {
      method: "POST",
      path: gatePath(getConfig(), "verify-session"),
      body: input,
      ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
    });
  },

  /**
   * Project-scoped end-user IdP provider-config management (create, list, update, test).
   * PROJECT_ADMIN+ required; end-user JWTs are rejected at the route.
   */
  identityProviders: makeIdentityProviders(getConfig),

  /**
   * Per-project magic-link redirect-URL allowlist management (list, add, remove).
   * PROJECT_ADMIN+ required; distinct from the end-user `passwordless` flow.
   */
  magicLinkRedirects: makeMagicLinkRedirects(getConfig),
  };
}

/** Singleton bound to the module-level `configureGate()` config.
 *  Per-instance clients: `createGateClient(config)`. */
export const gate = makeGateNamespace(getGateConfig);

/** Convenience type alias mirroring the `gate` runtime export.
 *  Identical shape as the per-instance `GateClient` returned from
 *  `createGateClient`. */
export type GateNamespace = ReturnType<typeof makeGateNamespace>;
