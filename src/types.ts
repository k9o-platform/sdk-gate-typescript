/**
 * `@k9o/gate` public types. They mirror what the end-user Gate routes answer; failures arrive as a `GateError`
 * (see `errors.ts`).
 */

/** The gateway's response envelope, generic over the `data` shape. Returned by every successful SDK call. */
export type Envelope<T> = {
  data: T;
  meta: Record<string, unknown>;
};

/** A project end-user (the customers of the project's customer). Ids carry the `eu_` prefix. */
export type EndUser = {
  /** `eu_<base62>`. */
  id: string;
  email: string;
  status: "active" | "pending" | "disabled";
  createdAt: string;
  updatedAt: string | null;
  lastSigninAt: string | null;
  /** Project-level roles; `PROJECT_END_USER` is the floor membership. */
  roles: ReadonlyArray<string>;
  /** Project-level group memberships. */
  groups: ReadonlyArray<string>;
};

/**
 * Session tokens returned by sign-up, sign-in, OTP and magic-link redemption. The access token is a JWT; the refresh
 * token is opaque and is presented to `gate.refreshToken` and `gate.signOut`.
 */
export type Session = {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 instant the access token expires. */
  expiresAt: string;
};

/** Sign-up and sign-in answer: `{ user, session }`. */
export type AuthResult = {
  user: EndUser;
  session: Session;
};

/** `gate.whoami()` answers the end-user record itself (no wrapper). */
export type WhoamiResult = EndUser;

/** `gate.refreshToken()` answers a new access token and a new refresh token; the refresh token you sent no longer works. */
export type RefreshResult = {
  accessToken: string;
  /** The session's next refresh token. Store it before the next refresh. */
  refreshToken: string;
  /** ISO 8601 instant the new access token expires. */
  expiresAt: string;
};

/** `gate.signOut()` answer. `revoked` is false when the token was unknown or already revoked. */
export type SignOutResult = { revoked: boolean };

/** `gate.revokeAllSessions()` answer: how many live sessions of the end user it ended. */
export type RevokeAllSessionsResult = { revokedCount: number };

/**
 * `gate.signUp` takes a CLOSED body: `{ email, password, displayName? }`. `displayName` is 1 to 128 characters; any
 * other field is refused by the gateway with `INVALID_FIELD_VALUE` (`context.reason: "unknown_field"`).
 */
export type SignUpInput = {
  email: string;
  password: string;
  /** Optional display name (1 to 128 characters); surfaces in account-management UI. */
  displayName?: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type SignOutInput = {
  /** The refresh token of the session to revoke (required by the route). */
  refreshToken: string;
};

export type RefreshTokenInput = {
  refreshToken: string;
};

/** OTP purpose: scopes the one-time code to a flow. The gateway defaults to `"signin"` when omitted. */
export type OtpPurpose = "signin" | "magic_link" | "password_reset" | "mfa_challenge";

/** `gate.passwordless.requestOtp` input: emails a one-time code to the address. */
export type RequestOtpInput = {
  email: string;
  /** OTP purpose; defaults to "signin" server-side when omitted. */
  purpose?: OtpPurpose;
};

/** `gate.passwordless.verifyOtp` input: the 6-character code from the email plus the address it went to. */
/** `gate.passwordless.requestOtp` answer. */
export type RequestOtpResult = {
  otp: { id: string; expiresAt: string };
  /** Only present on a deployment configured to return the code in the response (development). */
  debugCode?: string;
};

/**
 * `gate.passwordless.verifyOtp` answer. `session` and `endUserId` are present for the `signin` purpose; other
 * purposes only confirm the code (`endUserId` when the email belongs to an end-user).
 */
export type VerifyOtpResult = {
  verified: true;
  session?: Session;
  endUserId?: string;
};

export type VerifyOtpInput = {
  email: string;
  code: string;
  /** Must match the `purpose` supplied to `requestOtp` (defaults "signin")
   *  so the gateway resolves the right OTP row. */
  purpose?: OtpPurpose;
};

/** `gate.passwordless.requestMagicLink` input: emails a magic link to the address. */
export type RequestMagicLinkInput = {
  email: string;
  /**
   * Post-redeem landing URL. When supplied it MUST exact-match an entry in
   * the project's magic-link redirect allowlist (Gate config); a
   * non-allowlisted value is rejected with `GATE_REDIRECT_NOT_ALLOWED` (400).
   * Omit to use the project's configured default redirect.
   */
  redirectUrl?: string;
};

/** `gate.passwordless.verifyMagicLink` input: the opaque token from the magic-link query string. */
/** `gate.passwordless.requestMagicLink` answer. The same shape comes back for an unknown email. */
export type RequestMagicLinkResult = {
  magicLink: { sent: true; expiresAt?: string };
  /** Only present on a deployment configured to return the link in the response (development). */
  debugLink?: string;
};

/** `gate.passwordless.verifyMagicLink` answer: the new session and the end-user's id. */
export type VerifyMagicLinkResult = {
  redeemed: true;
  session: Session;
  endUserId: string;
};

export type VerifyMagicLinkInput = {
  token: string;
};

/**
 * Result of `gate.passwordless.parseMagicLinkCallback(window.location.search)`
 * on the magic-link landing page. The gateway delivers the opaque token in the
 * query string (`?token=…&project=…`); feed `token` to `verifyMagicLink`.
 * Distinct from `completeSignIn`, which exchanges the code in the SSO hash fragment.
 */
export type MagicLinkCallbackResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Claims of a Gate access token that `verifyJwt` resolves. Custom claims arrive FLAT under keys of the form
 * `ext.<namespace>.<name>`; they are available through the index signature.
 */
export type GateJwtClaims = {
  /** Issuer — the Kilimanjaro gateway base URL or project-bound issuer. */
  iss: string;
  /** Audience — typically the project id (`proj_<base62>`). */
  aud: string | string[];
  /** Subject — the end-user id (`eu_<base62>`). */
  sub: string;
  /** Issued-at (seconds since Unix epoch). */
  iat: number;
  /** Expiry (seconds since Unix epoch). */
  exp: number;
  /** JWT id (for revocation tracking + idempotency). */
  jti?: string;
  /** Project-level role array; floor is `PROJECT_END_USER`. */
  roles?: ReadonlyArray<string>;
  /** Project-level group memberships. */
  groups?: ReadonlyArray<string>;
  /** Scope strings, when the token carries them; used by `requireScope`. */
  scopes?: ReadonlyArray<string>;
  /** Email of the underlying end-user; convenience copy of the database column. */
  email?: string;
  /**
   * Additional claims that aren't part of the canonical set. The gateway
   * is free to embed custom claims per project policy.
   */
  [key: string]: unknown;
};

/**
 * `verifyJwt` result. `valid: true` resolves to the parsed claim set;
 * `valid: false` carries a typed reason for the failure (signature
 * mismatch, expiry, audience mismatch, etc.) without throwing.
 */
export type VerifyJwtResult =
  | { valid: true; claims: GateJwtClaims }
  | { valid: false; reason: VerifyJwtFailure };

export type VerifyJwtFailure =
  | "INVALID_SIGNATURE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "AUDIENCE_MISMATCH"
  | "ISSUER_MISMATCH"
  | "MALFORMED"
  | "ALGORITHM_NOT_ALLOWED";

/** The three calls the sign-in verifier needs; `sessionStorage` fits. */
export interface SignInStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Result of `gate.completeSignIn()` after the browser returns from a provider sign-in. On success, carries
 * the session tokens; on failure, carries an error subcode + description.
 */
export type SignInCallbackResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      /** ISO 8601 absolute expiry timestamp for the access token. */
      expiresAt: string;
      /** Always "Bearer" today; reserved for future schemes. */
      tokenType: string;
    }
  | {
      ok: false;
      /** IdpErrorSubcode ("sso_failed" | "idp_provider_not_configured" | …), "malformed_callback" if the fragment has no
       *  code, "verifier_missing" if this page has no stored verifier, or the exchange's reason ("idp_code_invalid" |
       *  "idp_code_expired" | "idp_code_used" | "idp_verifier_mismatch"). */
      error: string;
      errorDescription: string;
    };

/**
 * Per-call credential for the Gate calls that need a bearer token. Without it the call uses the token the client was
 * configured with (`partnerToken`).
 */
export type BearerOptions = {
  /** The bearer token to send for this call, for example an end user's access token. */
  bearerToken?: string;
};

/** A sign-in that needs a second step: a confirmed authenticator code, redeemed with the challenge id. */
export type MfaChallenge = {
  required: true;
  challengeId: string;
  expiresAt: string;
  methodsAvailable: ["totp"];
  resident: { region: string; origin: string };
};

/**
 * WebAuthn registration options as the gateway returns them (the JSON form of `PublicKeyCredentialCreationOptions`,
 * with `challenge` and the ids base64url-encoded). Pass it to the browser's or platform's passkey API.
 */
export type PasskeyRegistrationOptions = { challenge: string } & Record<string, unknown>;

/** WebAuthn authentication options as the gateway returns them (the JSON form of `PublicKeyCredentialRequestOptions`). */
export type PasskeyAuthenticationOptions = { challenge: string } & Record<string, unknown>;

/** The JSON form of the credential the authenticator made at registration (`RegistrationResponseJSON`). */
export type PasskeyRegistrationResponse = { id: string; response: Record<string, unknown> } & Record<string, unknown>;

/** The JSON form of the assertion the authenticator made at sign-in (`AuthenticationResponseJSON`). */
export type PasskeyAuthenticationResponse = { id: string; response: Record<string, unknown> } & Record<string, unknown>;

/** `gate.passkeys.register.finish` input. */
export type FinishPasskeyRegistrationInput = {
  /** What the authenticator made, in its JSON form. */
  response: PasskeyRegistrationResponse;
  /** A name for the passkey, 1 to 256 characters. */
  label?: string;
};

/** `gate.passkeys.register.finish` answer. */
export type FinishPasskeyRegistrationResult = { passkey: { id: string; credentialId: string } };

/** `gate.passkeys.signIn.begin` input. */
export type BeginPasskeySignInInput = {
  /** The account's email, 3 to 254 characters. Omit it to let the authenticator offer its own passkeys. */
  email?: string;
};

/** `gate.passkeys.signIn.finish` input. */
export type FinishPasskeySignInInput = {
  /** What the authenticator made, in its JSON form. */
  response: PasskeyAuthenticationResponse;
};

/** `gate.passkeys.signIn.finish` answer. */
export type FinishPasskeySignInResult = { session: Session };

/** `gate.mfa.totp.enroll` input. */
export type EnrollTotpInput = {
  /** A name for the authenticator, 1 to 256 characters. Defaults to `TOTP`. */
  label?: string;
};

/** `gate.mfa.totp.enroll` answer. The secret and the `otpauth://` uri are shown once; the factor is not usable until confirmed. */
export type EnrollTotpResult = { factor: { id: string; secret: string; uri: string } };

/** `gate.mfa.totp.confirm` input. */
export type ConfirmTotpInput = {
  /** The `factor.id` that `enroll` returned. */
  factorId: string;
  /** The current code from the authenticator app, 4 to 10 characters. */
  code: string;
  /** A current code from an authenticator the person has already confirmed. Required to add a second one. */
  currentCode?: string;
};

/**
 * `gate.mfa.totp.confirm` answer. When this is the person's first confirmed authenticator, their other sessions are
 * ended and the answer carries a new `session` for this one.
 */
export type ConfirmTotpResult = { factor: { id: string; verifiedAt: string }; session?: Session };

/** One second factor as `gate.mfa.methods.list` returns it. */
export type MfaMethod = {
  id: string;
  /** `totp` or `webauthn`. */
  type: string;
  label: string | null;
  /** When the factor was confirmed; `null` while it is only set up. */
  verifiedAt: string | null;
  createdAt: string;
};

/** `gate.mfa.methods.list` answer, oldest first. */
export type ListMfaMethodsResult = { methods: MfaMethod[] };

/** `gate.mfa.methods.delete` input. */
export type DeleteMfaMethodInput = {
  /** The current code of the authenticator being removed, 4 to 10 characters. Needed once it is confirmed. */
  code?: string;
};

/** `gate.mfa.methods.delete` answer. */
export type DeleteMfaMethodResult = { deleted: boolean };

/** `gate.passwordReset.request` input. */
export type RequestPasswordResetInput = { email: string };

/** `gate.passwordReset.request` answer. The answer is the same whether or not the email has an account. */
export type RequestPasswordResetResult = {
  reset: { requested: true; expiresAt?: string };
  /** Only present on a deployment configured to return the token in the response (development). */
  debugToken?: string;
};

/** `gate.passwordReset.redeem` input. */
export type RedeemPasswordResetInput = {
  /** The token from the reset email. */
  token: string;
  newPassword: string;
};

/** `gate.passwordReset.redeem` answer: a `session`, or an `mfa` challenge when the account has a confirmed authenticator. */
export type RedeemPasswordResetResult = { redeemed: true; endUserId: string } & (
  | { session: Session; mfa?: undefined }
  | { mfa: MfaChallenge; session?: undefined }
);

/** `gate.invitations.redeem` input. */
export type RedeemInvitationInput = {
  /** The token from the invitation. */
  token: string;
  password: string;
  /** Optional display name, 1 to 256 characters. */
  displayName?: string;
};

/** `gate.invitations.redeem` answer. */
export type RedeemInvitationResult = { redeemed: true; user: { id: string; email: string }; session: Session };

/** `gate.verifySession` input. */
export type VerifySessionInput = {
  /** The end user's access token to check. */
  token: string;
};

/** `gate.verifySession` answer: the token's claims, or the reason it was refused. */
export type VerifySessionResult =
  | { valid: true; claims: { subjectId: string; projectId: string; expiresAt: string } }
  | { valid: false; reason: string };
