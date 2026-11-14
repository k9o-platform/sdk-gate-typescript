/**
 * `@k9o/gate` — Gate (Identity-Aware Kernel) SDK entry point.
 *
 * Re-exports the public surface:
 *   - `gate` — marquee namespace + sub-namespaces
 *   - `configureGate` / `getGateConfig` / `resetGateConfig` — mode + config plumbing
 *   - `verifyJwt` / `extractClaims` / `requireScope` — standalone JWT primitives
 *   - `GateError` + `GateErrorCode` — KError-compatible error surface
 *   - All public types via `* from "./types.ts"`
 */

export { gate, type GateNamespace } from "./gate.ts";
export { createGateClient, type GateClient } from "./client-factory.ts";
export { parseApiHost, type ApiHost } from "./api-host.ts";
export { resolveRegionalOrigin, regionalOriginFromLocation, type RegionConfig } from "./region.ts";
export {
  configureGate,
  getGateConfig,
  resetGateConfig,
  type GateConfig,
  type GateClientConfig,
  type GateMode,
  type GateErrorDisclosure,
} from "./mode.ts";
export { verifyJwt, fetchJwks, extractClaims, requireScope, type VerifyJwtOptions } from "./jwt.ts";
export {
  GateError,
  K9OGateConfigError,
  type GateErrorCode,
  type KErrorWire,
  gateErrorFromWire,
} from "./errors.ts";
export type {
  Envelope,
  EndUser,
  Session,
  AuthResult,
  WhoamiResult,
  RefreshResult,
  SignOutResult,
  RevokeAllSessionsResult,
  BearerOptions,
  MfaChallenge,
  PasskeyRegistrationOptions,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationResponse,
  PasskeyAuthenticationResponse,
  FinishPasskeyRegistrationInput,
  FinishPasskeyRegistrationResult,
  BeginPasskeySignInInput,
  FinishPasskeySignInInput,
  FinishPasskeySignInResult,
  EnrollTotpInput,
  EnrollTotpResult,
  ConfirmTotpInput,
  ConfirmTotpResult,
  MfaMethod,
  ListMfaMethodsResult,
  DeleteMfaMethodInput,
  DeleteMfaMethodResult,
  RequestPasswordResetInput,
  RequestPasswordResetResult,
  RedeemPasswordResetInput,
  RedeemPasswordResetResult,
  RedeemInvitationInput,
  RedeemInvitationResult,
  VerifySessionInput,
  VerifySessionResult,
  SignUpInput,
  SignInInput,
  SignOutInput,
  RefreshTokenInput,
  OtpPurpose,
  RequestOtpInput,
  RequestOtpResult,
  VerifyOtpResult,
  VerifyOtpInput,
  RequestMagicLinkInput,
  RequestMagicLinkResult,
  VerifyMagicLinkResult,
  VerifyMagicLinkInput,
  SignInCallbackResult,
  SignInStorage,
  MagicLinkCallbackResult,
  GateJwtClaims,
  VerifyJwtResult,
  VerifyJwtFailure,
} from "./types.ts";
// Project-scoped end-user IdP provider-config management types (gate.identityProviders.*).
export type {
  IdpProviderKind,
  IdpConfig,
  CreateIdpInput,
  PatchIdpInput,
  DirectorySyncInput,
  IdentityProvidersNamespace,
} from "./idp-providers/identity-providers.ts";
