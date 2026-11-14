# Changelog

## 1.5.2

### Changed

- The `tierGating` option is removed from sign-in provider creation; the platform no longer gates features by plan.
- README: Architecture at a glance, illustrations, and the package table lists only the packages for that SDK.

## 1.5.0

### Changed

- **Breaking:** provider sign-in no longer puts tokens in the redirect URL. `signInWithProvider` keeps a one-time verifier (`sessionStorage`, or `storage`) and sends its S256 challenge; the browser returns to `redirectUri#code=...`, and the new `completeSignIn(hash?, { storage? })` exchanges the code and the verifier for the session (`POST /gate/idp/exchange`). `parseSignInCallback` is removed. Apps on 1.4 and earlier must upgrade for provider sign-in to work.
- A gateway error code the SDK does not name is kept as `GateError.code` with its full wire code (for example `K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED`), no longer collapsed to `INTERNAL_ERROR`. `GateErrorCode` now also admits any string. `context.originalCode` is unchanged.

### Added

- `mfa.methods.list()` (`GET /gate/mfa/methods`) and `mfa.methods.delete(methodId, { code? })` (`DELETE /gate/mfa/methods/{methodId}`): an end user lists and removes their own second factors, with their access token (`partnerToken` or `{ bearerToken }`). Removing a confirmed authenticator needs its current code. New types: `MfaMethod`, `ListMfaMethodsResult`, `DeleteMfaMethodInput`, `DeleteMfaMethodResult`.
- Methods for the end-user flows the gateway already serves, as the wire layer only (none calls a passkey API): `passkeys.register.begin` and `.finish`, `passkeys.signIn.begin` and `.finish`, `mfa.totp.enroll` and `.confirm`, `passwordReset.request` and `.redeem`, `invitations.redeem`, and `verifySession`. The calls that need an end user's access token (`passkeys.register.*`, `mfa.totp.*`, and `verifySession`'s own authentication) use `partnerToken` or a per-call `{ bearerToken }`; the others send none. New types: `BearerOptions`, `MfaChallenge`, `PasskeyRegistrationOptions`, `PasskeyAuthenticationOptions`, `PasskeyRegistrationResponse`, `PasskeyAuthenticationResponse`, `FinishPasskeyRegistrationInput` and `Result`, `BeginPasskeySignInInput`, `FinishPasskeySignInInput` and `Result`, `EnrollTotpInput` and `Result`, `ConfirmTotpInput` and `Result`, `RequestPasswordResetInput` and `Result`, `RedeemPasswordResetInput` and `Result`, `RedeemInvitationInput` and `Result`, `VerifySessionInput` and `Result`.
- One-time codes, magic links and password-reset requests are limited for each email address, and a code is spent after 5 wrong guesses. `verifyOtp` throws `INVALID_CREDENTIALS` for a wrong code and `RATE_LIMITED` (with `retryAfterSec`) over a limit. This needs gateway `2.71.75-beta` or later; on an older gateway codes can be guessed without limit.
- `signInWithProvider` accepts `apple`, `facebook` and `twitter` as well as `google`, `github`, `microsoft`, `oidc` and `saml`.
- `magicLinkRedirects.setDefault(id)`: make a registered redirect the default (`PATCH /gate/magic-link-redirects/:id` with `{ isDefault: true }`); the previous default is demoted in the same step.
- `GateError.publicMessage`: a fixed sentence chosen by status class, for showing to end users. Never built from gateway text.
- `GateError.requestId`: the gateway's `x-k9o-request-id` response header, or `null`.
- `errors` option on `createGateClient` and `configureGate`: `"full"` (default) or `"redacted"`. Redacted keeps the code, status, `requestId`, `publicMessage` and `retryAfterSec`, and drops `message`, `recommendation` and `context`. An invalid value throws `K9OGateConfigError` with `K9O_INVALID_FIELD_VALUE`.

- Password sign-in, one-time-code request and verify, and magic-link send first ask the project which region holds the email. If the project's locate step answers 404, the client uses the base address; any other failure of that step is raised as before.
- `orgSlug` option on `createGateClient` and `configureGate`, as an alternative to `baseUrl`. Alone it means `https://<orgSlug>.api.k9o.io`; with a platform host such as `https://api.k9o.io` it gives that host's organization form. A full organization `baseUrl` or a custom domain is used as given. With neither, or with a malformed slug, construction throws the new `K9OGateConfigError` (a `GateError`) with code `K9O_INVALID_BASE_URL` or `K9O_INVALID_FIELD_VALUE`. `baseUrl` is now optional in the type.
- `SignInStorage` type, and `verifier_missing` as a `SignInCallbackResult` error.

### Fixed

- A gateway error whose `recommendation` is an object (`{ action }` or `{ retryAfterSec, note }`) now gives the action text (or note) as `GateError.recommendation`, and any other non-string gives `null`. `GateError.retryAfterSec` holds the wait the gateway asked for, or `null`.
- `CreateIdpInput.redirectUri` is optional, as it is at the gateway (which derives the callback URL). A call that omitted it failed `tsc`.
- `verifyJwt` accepts `EdDSA` by default. Gate signs project tokens with EdDSA, so a token verified without `allowedAlgorithms` was rejected as `ALGORITHM_NOT_ALLOWED`.

## 1.4.0 — 2026-10-26

### Added

- README sections on identity federation and data scoping.

### Changed

- README description.

## 1.3.0 — 2026-10-26

The SDK now matches the gateway routes exactly.

### Changed

- `signOut` requires `{ refreshToken }` and returns `{ revoked }`.
- `whoami` returns the end user record itself.
- `refreshToken` returns `{ accessToken, expiresAt }`. The refresh token is not rotated.
- `passwordless.requestOtp` returns `{ otp: { id, expiresAt }, debugCode? }`.
- `passwordless.verifyOtp` returns `{ verified, session?, endUserId? }`. `session` is set only for the `signin` purpose.
- `passwordless.requestMagicLink` returns `{ magicLink: { sent, expiresAt? }, debugLink? }`.
- `passwordless.verifyMagicLink` returns `{ redeemed, session, endUserId }`.
- `verifyJwt({ jwksUrl })` reads the gateway's envelope-wrapped key set. The route is `GET /@{projectSlug}/auth/jwks`.
- Regional host lookup works for any `<org>.api.<apex>` host. No apex is hardcoded.

### Removed

- `verifySession` and `hosted`: the gateway has no route for them.

### Added

- `fetch` option on `verifyJwt` and the exported `fetchJwks` helper.

## 1.2.0 — 2026-10-25

- The README now introduces the Kilimanjaro building blocks (Keep, Pulse, Gate, Kibo). No change to the public API.

## 1.1.1 — 2026-10-25

- Documentation links corrected: the documentation hub is https://docs.kilimanjaro.dev, with the website, platform API and console listed in a Links section. Package metadata points at the same places.

## 1.1.0 — 2026-10-25

- Documentation rewritten with runnable examples and expected output; internal cross-references removed from the published sources. No change to the public API.

## 1.0.0 — 2026-10-23

First public release. See the README for the full API overview.
