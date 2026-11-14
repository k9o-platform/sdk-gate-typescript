/**
 * `jwt.ts` unit tests — JWT verification round-trip + claim extraction
 * + scope checking. Uses `jose` to mint test keys + tokens locally so
 * no network traffic happens.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import {
  GateError,
  extractClaims,
  requireScope,
  verifyJwt,
  type GateJwtClaims,
} from "../src/index.ts";

const ISSUER = "https://acme.api.example.test/@member-portal";
const AUDIENCE = "proj_test123";

let privateKey: KeyLike;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const exported = await exportJWK(pair.publicKey);
  exported.kid = "test-key-1";
  exported.alg = "RS256";
  exported.use = "sig";
  publicJwk = exported;
});

async function mintToken(
  claims: Partial<GateJwtClaims> & { sub: string },
  opts: { expiresIn?: string; notBefore?: string } = {},
): Promise<string> {
  const builder = new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt();
  builder.setExpirationTime(opts.expiresIn ?? "1h");
  if (opts.notBefore !== undefined) builder.setNotBefore(opts.notBefore);
  return builder.sign(privateKey);
}

describe("verifyJwt — default algorithms", () => {
  it("accepts an EdDSA token without allowedAlgorithms", async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = "eddsa-key-1";
    jwk.alg = "EdDSA";
    jwk.use = "sig";
    const token = await new SignJWT({ roles: ["PROJECT_END_USER"] })
      .setProtectedHeader({ alg: "EdDSA", kid: "eddsa-key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("eu_user1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pair.privateKey);
    const result = await verifyJwt({
      token,
      jwks: { keys: [jwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(true);
  });

  it("still rejects an algorithm outside the default set", async () => {
    const pair = await generateKeyPair("PS256");
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = "ps-key-1";
    jwk.alg = "PS256";
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "PS256", kid: "ps-key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("eu_user1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pair.privateKey);
    const result = await verifyJwt({
      token,
      jwks: { keys: [jwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(false);
  });
});

describe("verifyJwt — happy paths", () => {
  it("valid token round-trips and surfaces canonical claims", async () => {
    const token = await mintToken({
      sub: "eu_user1",
      email: "user@example.com",
      roles: ["PROJECT_END_USER"],
    });
    const result = await verifyJwt({
      token,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe("eu_user1");
      expect(result.claims.email).toBe("user@example.com");
      expect(result.claims.roles).toEqual(["PROJECT_END_USER"]);
      expect(typeof result.claims.iat).toBe("number");
      expect(typeof result.claims.exp).toBe("number");
    }
  });

  it("surfaces scope claims for downstream requireScope", async () => {
    const token = await mintToken({
      sub: "eu_user1",
      scopes: ["read:posts", "write:posts"],
    });
    const result = await verifyJwt({
      token,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.scopes).toEqual(["read:posts", "write:posts"]);
    }
  });
});

describe("verifyJwt — failure modes", () => {
  it("expired token surfaces EXPIRED", async () => {
    const token = await mintToken({ sub: "eu_user1" }, { expiresIn: "-1s" });
    const result = await verifyJwt({
      token,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      clockToleranceSeconds: 0,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("EXPIRED");
  });

  it("audience mismatch surfaces AUDIENCE_MISMATCH", async () => {
    const token = await mintToken({ sub: "eu_user1" });
    const result = await verifyJwt({
      token,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: "proj_other",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("AUDIENCE_MISMATCH");
  });

  it("issuer mismatch surfaces ISSUER_MISMATCH", async () => {
    const token = await mintToken({ sub: "eu_user1" });
    const result = await verifyJwt({
      token,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: "https://api.someone-else.io",
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("ISSUER_MISMATCH");
  });

  it("signature mismatch surfaces INVALID_SIGNATURE", async () => {
    const token = await mintToken({ sub: "eu_user1" });
    // Tamper the signature: flip the FIRST signature char. (Flipping the last
    // char is flaky — the final base64url char of a fixed-length signature
    // carries zero-padding bits, so an A<->B swap can leave the decoded bytes
    // unchanged ~2/3 of the time and the signature still verifies. The first
    // char always encodes meaningful high bits, so this is deterministic.)
    const [h, p, sig] = token.split(".") as [string, string, string];
    const tampered = `${h}.${p}.${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`;
    const result = await verifyJwt({
      token: tampered,
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("INVALID_SIGNATURE");
  });

  it("malformed token surfaces MALFORMED", async () => {
    const result = await verifyJwt({
      token: "garbage",
      jwks: { keys: [publicJwk as unknown as Record<string, unknown>] },
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("MALFORMED");
  });
});

describe("verifyJwt — jwksUrl reads the gateway's envelope-wrapped JWKS", () => {
  const URL_ = "https://acme.api.corp.internal/@member-portal/auth/jwks";

  it("unwraps { data: { keys }, meta } from the route and verifies", async () => {
    const seen: string[] = [];
    const f = (async (input: string | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ data: { keys: [publicJwk] }, meta: {} }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const token = await mintToken({ sub: "eu_user1" });
    const result = await verifyJwt({ token, jwksUrl: URL_, fetch: f, expectedIssuer: ISSUER, expectedAudience: AUDIENCE });
    expect(seen).toEqual([URL_]);
    expect(result.valid).toBe(true);
  });

  it("also accepts a bare { keys } set", async () => {
    const f = (async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })) as unknown as typeof globalThis.fetch;
    const token = await mintToken({ sub: "eu_user1" });
    const result = await verifyJwt({ token, jwksUrl: URL_, fetch: f });
    expect(result.valid).toBe(true);
  });

  it("throws UPSTREAM_UNAVAILABLE when the route answers something that is not a key set", async () => {
    const f = (async () => new Response(JSON.stringify({ code: "K9O_NOT_FOUND", message: "x" }), { status: 404 })) as unknown as typeof globalThis.fetch;
    const token = await mintToken({ sub: "eu_user1" });
    let caught: unknown;
    try {
      await verifyJwt({ token, jwksUrl: URL_, fetch: f });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("throws UPSTREAM_UNAVAILABLE on a network failure", async () => {
    const f = (async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const token = await mintToken({ sub: "eu_user1" });
    let caught: unknown;
    try {
      await verifyJwt({ token, jwksUrl: URL_, fetch: f });
    } catch (e) {
      caught = e;
    }
    expect((caught as GateError).code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("verifyJwt — option validation", () => {
  it("throws GateError when both jwksUrl and jwks are passed", async () => {
    let caught: unknown = null;
    try {
      await verifyJwt({
        token: "x",
        jwksUrl: "https://example.com/jwks.json",
        jwks: { keys: [] },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("INVALID_FIELD_VALUE");
  });

  it("throws GateError when neither jwksUrl nor jwks is passed", async () => {
    let caught: unknown = null;
    try {
      await verifyJwt({ token: "x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    expect((caught as GateError).code).toBe("INVALID_FIELD_VALUE");
  });
});

describe("extractClaims", () => {
  it("decodes claims without verifying signature", async () => {
    const token = await mintToken({
      sub: "eu_user1",
      email: "user@example.com",
      roles: ["PROJECT_END_USER", "PROJECT_AUTHOR"],
    });
    const claims = extractClaims(token);
    expect(claims.sub).toBe("eu_user1");
    expect(claims.email).toBe("user@example.com");
    expect(claims.roles).toEqual(["PROJECT_END_USER", "PROJECT_AUTHOR"]);
  });

  it("decodes claims for tokens with embedded slashes / base64url paddings", async () => {
    // Use a longish payload to exercise base64url decoding edge cases.
    const token = await mintToken({
      sub: "eu_user1",
      email: "a-very-long-email-address-that-pushes-base64-padding@example.com",
      roles: ["PROJECT_END_USER"],
      scopes: ["read:posts", "write:posts", "admin:projects"],
    });
    const claims = extractClaims(token);
    expect(claims.scopes).toEqual(["read:posts", "write:posts", "admin:projects"]);
  });

  it("throws on malformed tokens", () => {
    expect(() => extractClaims("not-a-jwt")).toThrow(GateError);
    expect(() => extractClaims("a.b")).toThrow(GateError);
    expect(() => extractClaims("a.b.c.d")).toThrow(GateError);
  });
});

describe("requireScope", () => {
  it("passes when all required scopes are present", () => {
    const claims = { sub: "eu_x", scopes: ["read:posts", "write:posts"] } as unknown as GateJwtClaims;
    expect(() => requireScope(claims, ["read:posts"])).not.toThrow();
    expect(() => requireScope(claims, ["read:posts", "write:posts"])).not.toThrow();
  });

  it("throws RBAC_DENY when any required scope is missing", () => {
    const claims = { sub: "eu_x", scopes: ["read:posts"] } as unknown as GateJwtClaims;
    let caught: unknown = null;
    try {
      requireScope(claims, ["read:posts", "admin:users"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
    const err = caught as GateError;
    expect(err.code).toBe("RBAC_DENY");
    expect(err.context["missingScopes"]).toEqual(["admin:users"]);
  });

  it("treats a missing scopes claim as empty (no scopes present)", () => {
    const claims = { sub: "eu_x" } as unknown as GateJwtClaims;
    let caught: unknown = null;
    try {
      requireScope(claims, ["read:posts"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });

  it("passes vacuously when the required-scope array is empty", () => {
    const claims = { sub: "eu_x", scopes: [] } as unknown as GateJwtClaims;
    expect(() => requireScope(claims, [])).not.toThrow();
  });
});
