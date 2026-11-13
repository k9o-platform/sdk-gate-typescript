# @k9o/gate

Official TypeScript SDK for [Kilimanjaro](#1410-about-kilimanjaro) Gate.
Sign users in to your app with Gate: sign-up, sign-in, sessions, one-time codes, magic links, identity federation (sign in with Google and
other identity providers) and JWT verification. A Gate token also scopes each data request to the signed-in user: a collection's end-user
policy limits them to the rows they own.

## Contents

**A. Get started**

1. [Links](#1-links)
2. [Install](#2-install)
3. [Choose the right package](#3-choose-the-right-package)
4. [Quick start](#4-quick-start)
5. [Client setup](#5-client-setup)

**B. Sign users in**

6. [Signing users in](#6-signing-users-in)
7. [Identity federation](#7-identity-federation)

**C. Sessions**

8. [Storing the session](#8-storing-the-session)
9. [Session lifetime and sign-out](#9-session-lifetime-and-sign-out)

**D. Use the token**

10. [Data scoping](#10-data-scoping)
11. [Verifying tokens](#11-verifying-tokens)

**E. Troubleshoot**

12. [Handling errors](#12-handling-errors)
13. [Regional hosts](#13-regional-hosts)

**F. Reference**

14. [Appendix](#14-appendix)
    - 14.1 [Requirements](#141-requirements)
    - 14.2 [Client options](#142-client-options)
    - 14.3 [Error fields](#143-error-fields)
    - 14.4 [Error codes](#144-error-codes)
    - 14.5 [Shared configuration](#145-shared-configuration)
    - 14.6 [Methods](#146-methods)
    - 14.7 [Token helpers](#147-token-helpers)
    - 14.8 [Verification options](#148-verification-options)
    - 14.9 [Failure reasons](#149-failure-reasons)
    - 14.10 [About Kilimanjaro](#1410-about-kilimanjaro)
15. [License](#15-license)

## A. Get started

### 1. Links

- Website: <https://kilimanjaro.dev>
- Documentation / Developer Hub: <https://docs.kilimanjaro.dev>
- API: <https://api.k9o.io>
- Console: <https://console.k9o.io>
- Open source
  - Platform: <https://github.com/k9o-platform>
  - Community: <https://github.com/k9o-community>

### 2. Install

```bash
npm install @k9o/gate
```

```bash
bun add @k9o/gate
```

```bash
pnpm add @k9o/gate
```

Requires Node.js 18+, Bun 1.1+ or a browser with a global `fetch`. See [Requirements](#141-requirements).

### 3. Choose the right package

| Package | Use it when you are… | Registry | Source |
| --- | --- | --- | --- |
| `@k9o/core` | Building a backend service that uses the platform's data, compute, governance and control features. | [npm](https://www.npmjs.com/package/@k9o/core) | [sdk-typescript](https://github.com/k9o-platform/sdk-typescript) |
| `@k9o/gate` | Implementing sign-up, sign-in, sessions, federation and end-user identity, or verifying a Gate token. | [npm](https://www.npmjs.com/package/@k9o/gate) | [sdk-gate-typescript](https://github.com/k9o-platform/sdk-gate-typescript) |
| `@k9o/extension-client` | Calling an extension installed in your project, by its slug, through typed bindings. To write an extension, use the extension runtime package instead. | [npm](https://www.npmjs.com/package/@k9o/extension-client) | [sdk-extension-client-typescript](https://github.com/k9o-platform/sdk-extension-client-typescript) |
| `@k9o/extension-runtime` | Writing an extension: reading and writing data, generating text and embeddings, and calling the platform services the extension's manifest grants. | [npm](https://www.npmjs.com/package/@k9o/extension-runtime) | [sdk-extension-runtime-typescript](https://github.com/k9o-platform/sdk-extension-runtime-typescript) |
| `@k9o/extension-manifest` | Declaring an extension's manifest: its permissions, surfaces and endpoints, checked the way the platform checks them at registration. | [npm](https://www.npmjs.com/package/@k9o/extension-manifest) | [sdk-extension-manifest-typescript](https://github.com/k9o-platform/sdk-extension-manifest-typescript) |
| `@k9o/kibo` | Keeping secrets in the vault, or encrypting and decrypting with a key you hold. | [npm](https://www.npmjs.com/package/@k9o/kibo) | [sdk-kibo-typescript](https://github.com/k9o-platform/sdk-kibo-typescript) |
| `@k9o/barbican` | Checking model input and redacting model output on your own machine, with no account. | [npm](https://www.npmjs.com/package/@k9o/barbican) | [sdk-barbican-typescript](https://github.com/k9o-platform/sdk-barbican-typescript) |
| `@k9o/cli` | Operating projects from a terminal or CI: migrations, functions, sign-in providers and secrets. | [npm](https://www.npmjs.com/package/@k9o/cli) | [k9o-cli](https://github.com/k9o-platform/k9o-cli) |

`@k9o/core` also exposes Gate as `k9o.gate` and the vault as `k9o.kibo.vault`.

### 4. Quick start

```ts
import { createGateClient } from "@k9o/gate";

const gate = createGateClient({
  mode: "native",
  baseUrl: "https://acme.api.k9o.io",
  projectSlug: "member-portal",
});

const result = await gate.signIn({ email: "alice@example.com", password: "a-long-passphrase" });
const user = result.data.user;

console.log(`Output: ${user.email}`);
```

```text
Output: alice@example.com
```

Every method resolves to `{ data, meta }`.

### 5. Client setup

The client is bound to one project. See [Client options](#142-client-options) for every option.

| Option | Meaning |
| --- | --- |
| `mode` | `"native"` or `"standalone"`. Required. Use `native` when your app is built on Kilimanjaro: Gate works with your project as it is. Use `standalone` when you use only Gate, from outside the platform: you also pass a `partnerToken` to show who you are. The calls are the same either way. |
| `projectSlug` | The project whose end users you manage. Required. |
| `baseUrl` | Gateway host. Optional when `orgSlug` is given. |
| `orgSlug` | Your organization's slug. Optional when `baseUrl` is given. |

Pass `orgSlug` to use your organization's host: `createGateClient({ mode: "native", orgSlug: "acme", projectSlug: "member-portal" })` sends requests to `https://acme.api.k9o.io`. A full organization `baseUrl` or a custom domain is used as given, and `orgSlug` does not change it. With neither `baseUrl` nor `orgSlug`, construction fails.

- `createGateClient` returns an independent client. Create one per tenant if you need several.
- Inside `@k9o/core`, the same client is `client.gate`. It reuses the core client's host, project and API key.
- To share one config, see [Shared configuration](#145-shared-configuration).

## B. Sign users in

### 6. Signing users in

Create a user, then sign in with a password. The session holds the access and refresh tokens.

```ts
const signedUp = await gate.signUp({ email: "grace@example.com", password: "another-long-passphrase" });
const session = signedUp.data.session;

const refreshed = await gate.refreshToken({ refreshToken: session.refreshToken });
console.log(`Output: ${JSON.stringify(Object.keys(refreshed.data))}`);

const revoked = await gate.signOut({ refreshToken: refreshed.data.refreshToken });
console.log(`Output: ${revoked.data.revoked}`);
```

```text
Output: ["accessToken","refreshToken","expiresAt"]
Output: true
```

- `refreshToken` returns a new access token and a new refresh token. The one you sent stops working, so store the new one before you refresh again. See [Session lifetime and sign-out](#9-session-lifetime-and-sign-out).
- `signOut` requires the session's current refresh token and ends the session. Sign out with the newest one: an older one answers `{ revoked: false }`.
- `whoami()` returns the signed-in user record itself.

#### Passwordless

Request a one-time code, then redeem it. A code issued for the default `signin` purpose returns a session.

```ts
const sent = await gate.passwordless.requestOtp({ email: "alice@example.com" });
console.log(`Output: ${sent.data.otp.id}`);

const verified = await gate.passwordless.verifyOtp({ email: "alice@example.com", code: "123456" });
console.log(`Output: ${verified.data.verified} ${verified.data.session?.accessToken !== undefined}`);
```

```text
Output: otp_01j9x2
Output: true true
```

- `requestOtp` returns `{ otp: { id, expiresAt } }`. `debugCode` appears only on a development deployment.
- `verifyOtp` returns `{ verified, session?, endUserId? }`. Other purposes return `verified` only.
- `requestMagicLink` returns `{ magicLink: { sent, expiresAt? } }`, and `debugLink` on a development deployment.
- `verifyMagicLink({ token })` returns `{ redeemed, session, endUserId }`.
- A magic-link `redirectUrl` must exactly match an entry in the project's allowlist.
- A wrong code throws `INVALID_CREDENTIALS`. A code is spent after 5 wrong guesses, so the next `verifyOtp` fails even with the right code: call `requestOtp` for a new one.
- Gate limits these calls for each email address. After 10 failed `verifyOtp` calls in an hour, or 20 in 24 hours, across every code and purpose, `verifyOtp` throws `RATE_LIMITED` (HTTP 429), and requesting a new code does not reset the count. `requestOtp` and `requestMagicLink` each allow 5 requests an hour and 20 in 24 hours for an address, and the same limit applies to a password-reset request. Over a limit they throw `RATE_LIMITED`.
- On `RATE_LIMITED`, wait `error.retryAfterSec` seconds before the next call and show the user `error.publicMessage`. The SDK does not retry for you. The limit is the same for an address that has an account and one that does not, so an app cannot tell the two apart by it.
- Do not put a service token or API key in browser code. A browser holds only the end user's own session.
- Browser sign-in with a provider uses `signInWithProvider`. See [Methods](#146-methods).

#### Passkeys

The passkey calls carry the options and the credential between your app and the gateway. They do not call the browser's or the platform's passkey API: pass the options from `begin` to that API, and send the credential it makes to `finish`.

```ts
// Add a passkey to the signed-in user (needs their access token as the bearer).
const options = await gate.passkeys.register.begin();
const credential = await startRegistration({ optionsJSON: options.data }); // your passkey library
const added = await gate.passkeys.register.finish({ response: credential, label: "Laptop" });
console.log(`Output: ${added.data.passkey.credentialId !== undefined}`);

// Sign in with a passkey (no token is sent).
const request = await gate.passkeys.signIn.begin({ email: "alice@example.com" });
const assertion = await startAuthentication({ optionsJSON: request.data }); // your passkey library
const signedIn = await gate.passkeys.signIn.finish({ response: assertion });
console.log(`Output: ${signedIn.data.session.accessToken !== undefined}`);
```

```text
Output: true
Output: true
```

- `register.begin()` and `register.finish({ response, label? })` need the end user's access token: the client's `partnerToken`, or `{ bearerToken }` as the last argument.
- `signIn.begin({ email? })` and `signIn.finish({ response })` send no token. Leave `email` out to let the authenticator offer the passkeys it holds for the site.
- A challenge is single use and short-lived. A challenge that is invalid, expired or used again throws `INVALID_FIELD_VALUE`.
- `startRegistration` and `startAuthentication` stand for the passkey library you use in the page or app. The SDK does not include one.

#### Authenticator app (TOTP)

```ts
const enrolled = await gate.mfa.totp.enroll({ label: "Phone" });
// Show enrolled.data.factor.uri as a QR code. The secret appears only in this answer.

const confirmed = await gate.mfa.totp.confirm({ factorId: enrolled.data.factor.id, code: "123456" });
console.log(`Output: ${confirmed.data.factor.verifiedAt !== undefined}`);
```

```text
Output: true
```

- Both calls need the end user's access token (`partnerToken` or `{ bearerToken }`).

List and remove second factors:

```ts
const { data } = await gate.mfa.methods.list();
console.log(`Output: ${data.methods.map((m) => m.type).join(", ")}`);

await gate.mfa.methods.delete(data.methods[0].id, { code: "123456" });
```

```text
Output: totp
```

- `list()` returns the signed-in user's factors, oldest first. A factor with `verifiedAt: null` is set up but not confirmed.
- `delete(methodId, { code? })` removes one. A confirmed authenticator needs its current code, otherwise it throws `K9O_MFA_REQUIRED`; a wrong code throws `INVALID_CREDENTIALS`. A pending factor needs no code. Returns `{ deleted }`.
- Both need the end user's access token (`partnerToken` or `{ bearerToken }` as the last argument).
- The factor does nothing until `confirm` succeeds. A wrong or expired code throws `INVALID_CREDENTIALS`.
- To add a second authenticator, pass `currentCode` from one already confirmed. Without it `confirm` throws `K9O_MFA_REQUIRED`.
- When it is the person's first confirmed authenticator, their other sessions end, and `confirm` returns a new `session` for this one.

#### Password reset

```ts
await gate.passwordReset.request({ email: "alice@example.com" });
// The email carries a token. Your reset page sends it back with the new password.
const reset = await gate.passwordReset.redeem({ token: tokenFromEmail, newPassword: "another-long-passphrase" });
console.log(`Output: ${reset.data.redeemed}`);
```

```text
Output: true
```

- `request({ email })` answers the same whether or not the address has an account. The token is valid for one hour and works once. On a deployment without a mail relay it throws `EMAIL_NOT_CONFIGURED` (HTTP 503).
- `redeem({ token, newPassword })` returns `{ redeemed, endUserId }` and a `session`. When the account has a confirmed authenticator it returns an `mfa` challenge (`challengeId`, `expiresAt`) and no session.
- Neither call sends a token. A wrong, expired or used token throws `INVALID_FIELD_VALUE`.
- `request` counts toward the per-address limit described under [Passwordless](#passwordless).

#### Invitations

An operator creates an invitation in the Console or through the API. The invited person redeems it with the token from the invitation.

```ts
const joined = await gate.invitations.redeem({ token: tokenFromInvitation, password: "another-long-passphrase", displayName: "Alice" });
console.log(`Output: ${joined.data.user.email}`);
```

```text
Output: alice@example.com
```

- `redeem({ token, password, displayName? })` sends no token and returns `{ redeemed, user: { id, email }, session }`.
- A wrong, expired or used token throws `INVALID_FIELD_VALUE`.

### 7. Identity federation

The identity provider is set up once, in the Console or with `k9o idp create`.
The SDK needs only the provider name and your redirect URI.

```ts
await gate.signInWithProvider({ provider: "google", redirectUri: "https://app.example.com/auth/callback" });
```

In a browser, set `baseUrl` to your organization's regional host, `https://<org>.api-<region>.<apex>`. On the region-free host the browser's preflight is refused and the call fails with `UPSTREAM_UNAVAILABLE` ("Failed to fetch"). See [Calling these routes from a browser](#12-handling-errors).

The SDK keeps a one-time verifier in `sessionStorage` and sends only its SHA-256 challenge, so no token travels in a URL. The browser leaves for Google and comes back to `/auth/callback#code=...`. The code grants nothing alone. On that page, exchange it for the session:

```ts
const callback = await gate.completeSignIn();

if (callback.ok) {
  console.log(`Output: ${callback.tokenType} ${callback.expiresAt}`);
} else {
  console.warn(callback.error);
}
// Output: Bearer 2026-11-01T12:15:00Z
```

`completeSignIn()` reads `location.hash`, removes the fragment from the address bar, and clears the stored verifier whatever the outcome. Pass the fragment as the first argument, and `{ storage }` for a host without `sessionStorage`. Persisting the returned tokens is up to you.

| `error` | Meaning |
|---|---|
| the provider's subcode (`sso_failed`, ...) | The provider or the gateway refused the sign-in. |
| `malformed_callback` | The fragment has no code. |
| `verifier_missing` | This tab has no stored verifier (another tab, or cleared storage). Start the sign-in again. |
| `idp_code_invalid`, `idp_code_expired`, `idp_code_used` | The code is wrong, older than 60 seconds, or already exchanged. |
| `idp_verifier_mismatch` | The code was not started by this page. |
| `K9O_RATE_LIMITED` | Too many exchange attempts for this project and client; wait and start again. |

This keeps tokens out of the URL and history. A script running on your own page can still read a session once it exists, so keep that page's scripts trusted.

```text
Output: Bearer 2026-10-26T12:00:00Z
```

- The origin of the redirect URI must be allowed by the project's configuration. Otherwise SDK sign-in is refused.
- The OAuth client and its secret are created in the Google Cloud console.
- `provider` is the provider you registered: `google`, `github`, `microsoft`, `apple`, `facebook`, `twitter`, `oidc` or `saml`. Register it once with `k9o idp create` or in the Console.
- On failure, `callback.ok` is `false` and `callback.error` and `callback.errorDescription` say why.

## Keep the session safe

## C. Sessions

### 8. Storing the session

`completeSignIn` and `signIn` return tokens; keeping them is your job. In a browser, keep the access token in memory only, and never in `localStorage`, where any script on the page can read it for as long as it lives. Keep the refresh token out of page storage too:

1. After `completeSignIn`, send the refresh token to your own server once, over TLS.
2. Your server stores it in a cookie that is `HttpOnly`, `Secure` and `SameSite=Lax`, and the page never sees it again.
3. When the access token expires, or the page reloads, the page asks your server. The server calls `gate.refreshToken` with the cookie's value, writes the new refresh token into the cookie, and returns only the new access token. Run one refresh at a time per session, because two tabs that refresh together send the same token twice, and the second is a replay (see [Session lifetime and sign-out](#9-session-lifetime-and-sign-out)).
4. On sign-out, your server calls `gate.signOut` and clears the cookie.

The mobile Gate SDKs (Swift, Kotlin, Flutter and React Native) already keep the refresh token in the device's secure storage, so a mobile app does not need this pattern. Neither a browser nor a mobile app should hold a service token or API key.

### 9. Session lifetime and sign-out

Three settings control how long an end user's session lasts. A project administrator sets them for the project in the Console, under the project's Gate settings, Sessions. The values below are the defaults, and each has a range:

| Setting | Default | Range |
|---|---|---|
| Access token lifetime | 30 minutes | 5 to 60 minutes |
| Sign out after inactivity | 30 days | 1 hour to 90 days |
| Maximum session length | 90 days | 1 hour to 365 days |

Refresh is where the limits are checked. Inactivity counts from the last successful refresh, so it is measured to within one access-token lifetime. A refresh token never outlasts either limit. A changed setting applies to existing sessions at their next refresh, and a shorter maximum ends the sessions already past it.

- **Each refresh replaces the refresh token.** `gate.refreshToken` returns a new one, and the one you sent stops working. Store the new token before you refresh again, and keep it as you would a password, never in page storage or logs.
- **A used token sent again ends the session.** The refresh is refused with `SESSION_EXPIRED` and `context.reason` of `replay`, and the session is revoked: the newest token is then refused with `reason` of `revoked`. Two refreshes that run at the same time on one token count as this, so refresh one at a time per session, for example with a lock on your server. The user signs in again, and a new sign-in starts a new session. Under `errors: "redacted"` the context is dropped, so only the code is available.
- **`gate.signOut` ends one session.** It revokes the session that the current refresh token you send belongs to; an older token answers `{ revoked: false }`. The same user's sessions on other devices stay valid.
- **`gate.revokeAllSessions` ends every session of the user.** Call it with the end user's access token as the client's bearer token, the same token `whoami` uses; a refresh token does not work here. It ends the user's sessions on every device, this one included, and answers `{ revokedCount }`. Each ended session's next refresh is refused with `SESSION_EXPIRED` and `context.reason` of `revoked`, so discard the stored refresh token after the call. An operator's token is refused with `K9O_TRUST_ZONE_VIOLATION` (403), and a token issued for another project with `K9O_PROJECT_SCOPE_MISMATCH` (403); the SDK keeps the `K9O_` prefix on both.
- **An access token outlives sign-out.** One that was already issued keeps working until it expires, up to the access token lifetime you set, because it carries no session id and Gate keeps no list of revoked access tokens. The exception is a user who is no longer active: a locked or erased user's access tokens are refused at once.
- **A session that has passed a limit is refused.** The refresh answers 401 `K9O_SESSION_EXPIRED`, and `context.reason` is `inactive`, `max_length`, `revoked` (after sign-out or after `revokeAllSessions`) or `replay` (a used refresh token sent again). Send the user through sign-in again.
- **A password reset ends every existing session of that user.** The session the reset itself opens stays. Gate has no call for an end user to change a password. Erasing a user locks them and revokes every session; an administrator's reset of a user's second factor also revokes every session.

If a refresh token leaks, sign out with the newest one. If someone else has already refreshed with it, your next refresh is refused as a replay and that ends the session too. The access tokens already issued expire within the access token lifetime.

## Use the session on your backend

## D. Use the token

### 10. Data scoping

A Gate access token limits a data request to the signed-in user's own rows. Use the end user's access token as the `apiKey` of the core client.

```ts
import { createClient } from "@k9o/core";

type Task = { id: string; title: string };

const asUser = createClient({
  apiKey: callback.accessToken,
  orgSlug: "acme",
  projectSlug: "member-portal",
});

const mine = await asUser.from("tasks").select<Task>();

console.log(`Output: ${mine.data.length}`);
```

```text
Output: 3
```

- The collection must declare an owner column. An end user reads and writes only rows whose owner is their user ID.
- Rows owned by another user are not returned: the request returns only the rows the user owns.
- An insert that names a different owner is refused with `K9O_INVALID_FIELD_VALUE`. If the owner is omitted, it is set to the caller.
- A collection with no owner column refuses end-user writes.
- A collection can opt out of scoping explicitly. Then every end user sees every row.

### 11. Verifying tokens

Backends can verify Gate tokens without creating a client. `verifyJwt` returns a result and does not throw for a bad token.

```ts
import { verifyJwt } from "@k9o/gate";

const verification = await verifyJwt({
  token: accessToken,
  jwksUrl: "https://acme.api.k9o.io/@member-portal/auth/jwks",
  expectedIssuer: "<the iss your project's tokens carry>",
  expectedAudience: "<the aud your backend accepts>",
});

if (verification.valid) {
  console.log(`Output: ${verification.claims.sub}`);
} else {
  console.warn(verification.reason);
}
```

```text
Output: eu_01j9x2k4m7
```

- Always set `expectedIssuer` and `expectedAudience`. Without them a validly signed token minted for another audience is accepted. Read both values from a token your project issued.
- `extractClaims` only decodes. It checks no signature, expiry, issuer or audience, so never use its result to decide who a caller is.
- The project key set is at `GET /@{projectSlug}/auth/jwks`. Organization keys are at `/auth/jwks`.
- The gateway wraps the key set in its `{ data, meta }` envelope. `verifyJwt` unwraps it for you.
- To fetch the key set yourself, call `fetchJwks(url)`. Pass `fetch` in the options to use your own `fetch`.

- Set exactly one of `jwksUrl` or `jwks`. See [Verification options](#148-verification-options).
- A failed check returns one of the [Failure reasons](#149-failure-reasons).
- `requireScope(claims, scopes)` throws `RBAC_DENY` if a scope is missing.

To have the gateway check a token instead, call `verifySession` from your backend. The call is authenticated with the bearer your client holds (`partnerToken`, or `{ bearerToken }` as the second argument); the token to check goes in the body.

```ts
const checked = await gate.verifySession({ token: accessToken });
if (checked.data.valid) {
  console.log(`Output: ${checked.data.claims.subjectId}`);
} else {
  console.warn(checked.data.reason);
}
```

- A token the gateway refuses is an answer with `valid: false` and a `reason`, not an error. Refused tokens include an invalid or expired one, one minted for another project, and one of an end user who is no longer active.
- The check is one request to the gateway per token. `verifyJwt` checks a token locally against the project's key set and makes no request per token.

## E. Troubleshoot

### 12. Handling errors

Failures throw `GateError`. Switch on `code`.

```ts
import { GateError } from "@k9o/gate";

try {
  await gate.signIn({ email: "alice@example.com", password: "wrong" });
} catch (error) {
  if (error instanceof GateError && error.code === "INVALID_CREDENTIALS") {
    console.warn("Wrong email or password");
  } else {
    throw error;
  }
}
```

See [Error codes](#144-error-codes) for the full list. The full wire code is kept in `context.originalCode`.

Calling these two routes from a browser:
- Set `baseUrl` to your organization's regional host, `https://<org>.api-<region>.<apex>`. On the region-free host `<org>.api.<apex>` the browser's preflight is refused, the POST is never sent, and the call fails with `UPSTREAM_UNAVAILABLE` ("Failed to fetch").
- `signInWithProvider` and `completeSignIn` send no `Authorization` header, even when a `partnerToken` is configured. The browser would refuse a preflight that asks for one, and neither route reads it.

### 13. Regional hosts

- On an organization host shaped `<org>.api.<apex>`, the client sends one `HEAD` request first.
- The request carries no credentials. It finds the regional host for your organization.
- All later requests go to that host. The answer is cached.
- Any apex works, including an internal or air-gapped one. The client hardcodes none.
- Any other `baseUrl` is used as given. If the lookup fails, the configured host is used.
- Password sign-in, one-time codes and magic links first ask the project which region holds the email. If the project's locate step answers 404, the client uses the base address.

## F. Reference

### 14. Appendix

- [Requirements](#141-requirements)
- [Client options](#142-client-options)
- [Error fields](#143-error-fields)
- [Error codes](#144-error-codes)
- [Shared configuration](#145-shared-configuration)
- [Methods](#146-methods)
- [Token helpers](#147-token-helpers)
- [Verification options](#148-verification-options)
- [Failure reasons](#149-failure-reasons)
- [About Kilimanjaro](#1410-about-kilimanjaro)

#### 14.1 Requirements

| Requirement | Version |
| --- | --- |
| Node.js | 18 or newer |
| Bun | 1.1 or newer |
| TypeScript (optional) | 5.6 or newer |
| Browser | Any with a global `fetch` |

Token verification uses the `jose` library, which installs with the package.

#### 14.2 Client options

| Option | Meaning |
| --- | --- |
| `mode` | `"native"` or `"standalone"`. Required. |
| `projectSlug` | The project whose end users you manage. Required. |
| `baseUrl` | Gateway host, such as `https://acme.api.k9o.io`. Optional when `orgSlug` is given. |
| `orgSlug` | Your organization's slug, such as `acme`. Optional when `baseUrl` is given. Alone, it means `https://<orgSlug>.api.k9o.io`. With a platform host such as `https://api.k9o.io`, it gives that host's organization form. Any other `baseUrl` is used as given. |
| `partnerToken` | Bearer token sent with requests that need one. |
| `fetch` | Custom `fetch` implementation. |
| `errors` | `"full"` (default) or `"redacted"`. With `"redacted"`, an error keeps its code (an unknown code becomes `INTERNAL_ERROR`), `status`, `requestId`, `publicMessage` and `retryAfterSec`, and drops `message`, `recommendation` and `context`. |

An invalid `mode` or a missing `projectSlug` throws a `TypeError`. Neither `baseUrl` nor `orgSlug` throws a `K9OGateConfigError` (a `GateError`) with code `K9O_INVALID_BASE_URL` and `context.field` of `"baseUrl"`. An `orgSlug` that is not 2-63 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen, throws a `K9OGateConfigError` with code `K9O_INVALID_FIELD_VALUE` and `context` of `{ field: "orgSlug", slug }`. An `errors` value other than `"full"` or `"redacted"` throws a `K9OGateConfigError` with code `K9O_INVALID_FIELD_VALUE` and `context` of `{ field: "errors", value }`.

#### 14.3 Error fields

| Field | Meaning |
| --- | --- |
| `code` | Stable string. Switch on this. A code the SDK does not name keeps the gateway's full code, such as `K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED`. |
| `message` | Human-readable explanation, for logs. |
| `context` | Per-code details, for logs. |
| `recommendation` | Suggested next step as text, or `null`, for logs. The gateway may send it as an object such as `{ "action": "..." }`; you get the action text. |
| `retryAfterSec` | Seconds the gateway asks you to wait before retrying, or `null`. |
| `status` | HTTP status the gateway returned, or `null` when no response came back. |
| `publicMessage` | A fixed sentence chosen by status class, such as "Something went wrong. Try again later.". Show this to your users. It is never built from gateway text. |
| `requestId` | The gateway's request id (the `x-k9o-request-id` response header), or `null`. Log this for support. |

An app shows `publicMessage` to its users and logs `requestId`. `message`, `recommendation` and `context` are for logs. They can carry gateway detail, so do not show them to end users.

#### 14.4 Error codes

Codes the SDK names have no `K9O_` prefix. A code it does not name keeps its full gateway code.

| Code | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | No valid credential was supplied. |
| `INVALID_CREDENTIALS` | Email or password is wrong. |
| `EMAIL_ALREADY_REGISTERED` | The email already has an account. |
| `RATE_LIMITED` | Too many requests, or too many failed one-time-code guesses, for this address. Wait `retryAfterSec` seconds. |
| `INVALID_FIELD_VALUE` | Input failed validation. |
| `SESSION_EXPIRED` | The session has expired. |
| `REFRESH_TOKEN_INVALID` | The refresh token was rejected. |
| `RBAC_DENY` | The caller lacks a required role or scope. |
| `FORBIDDEN` | The caller may not do this. |
| `NOT_FOUND` | The resource does not exist. |
| `TIER_FEATURE_GATED` | The project's plan does not include this. |
| `GATE_REDIRECT_NOT_ALLOWED` | The redirect URL is not on the allowlist. |
| `POLICY_AUTHORING_AUTHORITY_INSUFFICIENT` | The caller may not author this policy. |
| `UPSTREAM_UNAVAILABLE` | The gateway could not be reached. |
| `INTERNAL_ERROR` | Unexpected failure. With `errors: "redacted"` it also stands in for a code the SDK does not name. |

#### 14.5 Shared configuration

| Function | What it does |
| --- | --- |
| `configureGate(config)` | Sets the config used by the exported `gate` singleton. |
| `getGateConfig()` | Reads the shared config. |
| `resetGateConfig()` | Clears the shared config. |

#### 14.6 Methods

| Method | What it does |
| --- | --- |
| `signUp({ email, password, displayName? })` | Creates an end user and a session. |
| `signIn({ email, password })` | Authenticates with a password. |
| `signOut({ refreshToken })` | Revokes the session when you send its current refresh token. Returns `{ revoked }`. |
| `whoami()` | Returns the signed-in end user record. |
| `revokeAllSessions()` | Ends every session of the signed-in end user, on every device. Returns `{ revokedCount }`. |
| `refreshToken({ refreshToken })` | Returns `{ accessToken, refreshToken, expiresAt }`. The refresh token you sent stops working. |
| `signInWithProvider({ provider, redirectUri, storage? })` | Keeps a one-time verifier and sends the browser to a provider. |
| `completeSignIn(hash?, { storage? })` | Exchanges the `#code=` from the redirect for the session. |
| `passwordless.requestOtp({ email, purpose? })` | Emails a code. Returns `{ otp: { id, expiresAt }, debugCode? }`. |
| `passwordless.verifyOtp({ email, code, purpose? })` | Returns `{ verified, session?, endUserId? }`. |
| `passwordless.requestMagicLink({ email, redirectUrl? })` | Returns `{ magicLink: { sent, expiresAt? }, debugLink? }`. |
| `passwordless.verifyMagicLink({ token })` | Returns `{ redeemed, session, endUserId }`. |
| `passwordless.parseMagicLinkCallback(search)` | Reads the token from the redirect query string. |
| `passkeys.register.begin()` | Starts adding a passkey for the signed-in user. Returns the registration options. |
| `passkeys.register.finish({ response, label? })` | Finishes it with the credential the authenticator made. Returns `{ passkey: { id, credentialId } }`. |
| `passkeys.signIn.begin({ email? })` | Starts a passkey sign-in. Returns the authentication options. |
| `passkeys.signIn.finish({ response })` | Finishes it with the assertion the authenticator made. Returns `{ session }`. |
| `mfa.totp.enroll({ label? })` | Starts setting up an authenticator app. Returns `{ factor: { id, secret, uri } }`. |
| `mfa.totp.confirm({ factorId, code, currentCode? })` | Confirms it with the first code. Returns `{ factor: { id, verifiedAt }, session? }`. |
| `mfa.methods.list()` | Lists the signed-in user's second factors. Returns `{ methods: [{ id, type, label, verifiedAt, createdAt }] }`. |
| `mfa.methods.delete(methodId, { code? })` | Removes a second factor; a confirmed authenticator needs its current code. Returns `{ deleted }`. |
| `passwordReset.request({ email })` | Emails a reset token. Returns `{ reset: { requested, expiresAt? } }`. |
| `passwordReset.redeem({ token, newPassword })` | Sets the new password. Returns `{ redeemed, endUserId }` and a `session` or an `mfa` challenge. |
| `invitations.redeem({ token, password, displayName? })` | Accepts an invitation. Returns `{ redeemed, user, session }`. |
| `verifySession({ token })` | Asks the gateway whether an end user's access token is valid. Returns `{ valid: true, claims }` or `{ valid: false, reason }`. |
| `magicLinkRedirects` | For project admins and back-end code: manage the redirect allowlist. |

- `provider` is `"google"`, `"github"`, `"microsoft"`, `"apple"`, `"facebook"`, `"twitter"`, `"oidc"` or `"saml"`.
- `session` is returned by `verifyOtp` only for the default `signin` purpose.

#### 14.7 Token helpers

| Function | What it does |
| --- | --- |
| `verifyJwt(options)` | Verifies a token and returns a result. |
| `extractClaims(token)` | Decodes claims without verifying them. Do not use it to authenticate. |
| `requireScope(claims, scopes)` | Throws `RBAC_DENY` if a scope is missing. |
| `fetchJwks(url, fetch?)` | Reads a key set from the gateway and unwraps the envelope. |

#### 14.8 Verification options

| Option | Meaning |
| --- | --- |
| `token` | The JWT to verify. |
| `jwksUrl` | Key set URL, such as `/@{projectSlug}/auth/jwks`. Set this or `jwks`. |
| `jwks` | Inline key set. Set this or `jwksUrl`. |
| `fetch` | Custom `fetch` used to read `jwksUrl`. |
| `expectedIssuer` | Required `iss` claim. Set it. |
| `expectedAudience` | Required `aud` claim. Set it. |
| `allowedAlgorithms` | Defaults to `EdDSA`, `RS256` and `ES256`. |
| `clockToleranceSeconds` | Defaults to 30. |

#### 14.9 Failure reasons

| Reason | Meaning |
| --- | --- |
| `INVALID_SIGNATURE` | The signature does not match. |
| `EXPIRED` | The token has expired. |
| `NOT_YET_VALID` | The token is not valid yet. |
| `AUDIENCE_MISMATCH` | The audience differs. |
| `ISSUER_MISMATCH` | The issuer differs. |
| `MALFORMED` | The token cannot be parsed. |
| `ALGORITHM_NOT_ALLOWED` | The algorithm is not in the allowed list. |


#### 14.10 About Kilimanjaro

Kilimanjaro is a modular developer platform for building secure enterprise applications. You define AI agents, functions and data pipelines
on the platform. The SDKs let you deploy and invoke them, read and write your data, publish to and subscribe to streams, sign users in, and
encrypt with keys you hold.

It provides four building blocks:

- **Keep**: AI security and governance. Guardrails and policy for the agents you run.
- **Pulse**: data intelligence and real-time stream processing. Streams, analytics and live feeds.
- **Gate**: customer identity and access management. Sign-in and sessions, and automatic data scoping so a signed-in user reaches only their own data.
- **Kibo**: cryptographic keys and secrets management. Client-side encryption with keys you hold, and a secrets vault.

### 15. License

Apache-2.0 © Formelo Inc. See `LICENSE` and `NOTICE`.
