/**
 * `gate.identityProviders.create` unit tests.
 *
 * Validates URL construction + method + body pass-through + envelope unwrap
 * + error propagation against a stubbed fetch. Targets the project-plane
 * `/@<projectSlug>/identity-providers` create route
 * (`services/gateway/src/routes/project-identity-providers.ts`).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, gate, resetGateConfig, GateError } from "../src/index.ts";
import type { CreateIdpInput } from "../src/index.ts";

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

const META = {} as Record<string, unknown>;

// The gateway `shapeIdpConfig` wire shape, verbatim (services/gateway/src/routes/project-identity-providers.ts).
// Reads carry `clientSecretSet` — a presence boolean — never the secret or a handle (the
// write-only fix). This mock previously returned a `clientSecretRef` the gateway stopped
// sending, so the SDK type drifted from the wire while these tests stayed green; keep it byte-for-byte real.
const SAMPLE_CONFIG = {
  id: "epc_abcdef012345",
  projectId: "proj_xyz789",
  idpProvider: "google",
  displayName: "Google Workspace",
  clientId: "1234.apps.googleusercontent.com",
  clientSecretSet: true,
  redirectUri: "https://member-portal.example.com/auth/callback",
  metadataUrl: null,
  attributeMap: {},
  enabled: false,
  allowedRedirectUris: [],
  directoryPullEnabled: false,
  directorySyncSubject: null,
  directorySyncIntervalMins: null,
  directorySyncLastRunAt: null,
  directorySyncLastStatus: null,
  createdAt: "2026-09-02T15:00:00Z",
  updatedAt: null,
};

const MINIMAL_INPUT: CreateIdpInput = {
  idpProvider: "google",
  displayName: "Google Workspace",
  clientId: "1234.apps.googleusercontent.com",
  clientSecretRef: "the-raw-oauth2-client-secret",
  redirectUri: "https://member-portal.example.com/auth/callback",
};

describe("gate.identityProviders.create", () => {
  it("POSTs to /@<projectSlug>/identity-providers with the body + returns the config envelope", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: SAMPLE_CONFIG, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const envelope = await gate.identityProviders.create(MINIMAL_INPUT);
    expect(envelope.data.id).toBe("epc_abcdef012345");
    expect(envelope.data.idpProvider).toBe("google");
    // The response carries only a presence flag, never the submitted secret or a handle.
    expect(envelope.data.clientSecretSet).toBe(true);
    expect(JSON.stringify(envelope.data)).not.toContain("the-raw-oauth2-client-secret");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/identity-providers");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual(MINIMAL_INPUT);
  });

  it("passes the optional fields through verbatim (metadataUrl, attributeMap, enabled, allowedRedirectUris)", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: { ...SAMPLE_CONFIG, idpProvider: "oidc" }, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    const input: CreateIdpInput = {
      idpProvider: "oidc",
      displayName: "Corp OIDC",
      clientId: "corp-oidc-client",
      clientSecretRef: "secret",
      redirectUri: "https://member-portal.example.com/auth/callback",
      metadataUrl: "https://idp.corp.example.com/.well-known/openid-configuration",
      attributeMap: { email: "mail", name: "displayName" },
      enabled: true,
      allowedRedirectUris: ["https://app.corp.example.com", "https://staging.corp.example.com"],
    };
    await gate.identityProviders.create(input);
    expect(calls[0]?.body).toEqual(input);
  });

  it("propagates FORBIDDEN when a non-PROJECT_ADMIN (or end-user) token is rejected", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(403, {
        code: "K9O_RBAC_DENY",
        message: "Creating an identity provider config requires PROJECT_ADMIN",
        context: { role: "PROJECT_EDITOR" },
      }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "member-portal",
      baseUrl: "https://api.example.test",
      fetch: fn,
    });
    let caught: unknown = null;
    try {
      await gate.identityProviders.create(MINIMAL_INPUT);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });

  it("addresses the slug member-plane path against the org subdomain", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: SAMPLE_CONFIG, meta: META }),
    );
    configureGate({
      mode: "standalone",
      projectSlug: "partner-console-staging",
      baseUrl: "https://acme.api.example.test",
      fetch: fn,
    });
    await gate.identityProviders.create(MINIMAL_INPUT);
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.url).toBe(
      "https://acme.api.example.test/@partner-console-staging/identity-providers",
    );
  });
});

describe("gate.identityProviders.list", () => {
  it("GETs /@<projectSlug>/identity-providers (no body) + returns the config array envelope", async () => {
    const { fn, calls } = captureFetch(() =>
      jsonResponse(200, { data: [SAMPLE_CONFIG, { ...SAMPLE_CONFIG, id: "epc_222", idpProvider: "oidc" }], meta: META }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    const envelope = await gate.identityProviders.list();
    expect(envelope.data).toHaveLength(2);
    expect(envelope.data[0]?.id).toBe("epc_abcdef012345");
    // Each entry carries only a presence flag, never a secret or handle.
    expect(envelope.data[0]?.clientSecretSet).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/identity-providers");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.body).toBeUndefined(); // a read carries no body
  });

  it("addresses the slug member-plane path against the org subdomain", async () => {
    const { fn, calls } = captureFetch(() => jsonResponse(200, { data: [], meta: META }));
    configureGate({ mode: "standalone", projectSlug: "partner-console-staging", baseUrl: "https://acme.api.example.test", fetch: fn });
    await gate.identityProviders.list();
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.url).toBe("https://acme.api.example.test/@partner-console-staging/identity-providers");
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.method).toBe("GET");
  });

  it("propagates a gateway error envelope as GateError", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(403, { code: "K9O_FORBIDDEN", message: "role lacks read access", context: {} }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    let caught: unknown = null;
    try {
      await gate.identityProviders.list();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });
});

describe("gate.identityProviders.testProvider", () => {
  it("POSTs to /@<projectSlug>/identity-providers/<id>/test (no body) + returns the verdict envelope", async () => {
    const { fn, calls } = captureFetch(() => jsonResponse(200, { data: { ok: true }, meta: META }));
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    const envelope = await gate.identityProviders.testProvider("epc_abcdef012345");
    expect(envelope.data.ok).toBe(true);
    expect(envelope.data.reason).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/identity-providers/epc_abcdef012345/test");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBeUndefined(); // the probe takes no body — the id is in the path
  });

  it("surfaces a closed-enum reason on a !ok verdict (never the upstream body)", async () => {
    const { fn } = captureFetch(() => jsonResponse(200, { data: { ok: false, reason: "endpoint_forbidden" }, meta: META }));
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    const envelope = await gate.identityProviders.testProvider("epc_222");
    expect(envelope.data.ok).toBe(false);
    expect(envelope.data.reason).toBe("endpoint_forbidden");
  });

  it("url-encodes the config id + addresses the org-subdomain member plane", async () => {
    const { fn, calls } = captureFetch(() => jsonResponse(200, { data: { ok: false, reason: "secret_not_provisioned" }, meta: META }));
    configureGate({ mode: "standalone", projectSlug: "partner-console-staging", baseUrl: "https://acme.api.example.test", fetch: fn });
    await gate.identityProviders.testProvider("epc /weird");
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.url).toBe("https://acme.api.example.test/@partner-console-staging/identity-providers/epc%20%2Fweird/test");
    expect(calls.filter((c) => c.method !== "HEAD")[0]?.method).toBe("POST");
  });

  it("propagates a gateway error envelope (e.g. RBAC deny) as GateError", async () => {
    const { fn } = captureFetch(() => jsonResponse(403, { code: "K9O_RBAC_DENY", message: "requires PROJECT_ADMIN", context: {} }));
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    let caught: unknown = null;
    try {
      await gate.identityProviders.testProvider("epc_abcdef012345");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });
});

describe("gate.identityProviders.update", () => {
  it("PATCHes the config by id with the patch verbatim and unwraps the updated config", async () => {
    const updated = { ...SAMPLE_CONFIG, directoryPullEnabled: true, directorySyncSubject: "admin@example.com", directorySyncIntervalMins: 60 };
    const { fn, calls } = captureFetch(() => jsonResponse(200, { data: updated, meta: META }));
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    const envelope = await gate.identityProviders.update("epc_abcdef012345", {
      directoryPullEnabled: true,
      directorySyncIntervalMins: 60,
      directorySyncSubject: "admin@example.com",
      serviceAccountKey: "{\"type\":\"service_account\"}",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/identity-providers/epc_abcdef012345");
    expect(calls[0]?.body).toEqual({
      directoryPullEnabled: true,
      directorySyncIntervalMins: 60,
      directorySyncSubject: "admin@example.com",
      serviceAccountKey: "{\"type\":\"service_account\"}",
    });
    // Directory status is read back off the config; the key itself is never in a read.
    expect(envelope.data).toMatchObject({ directoryPullEnabled: true, directorySyncIntervalMins: 60 });
    expect(JSON.stringify(envelope.data)).not.toContain("service_account");
  });

  it("encodes the config id into the path (no path injection)", async () => {
    const { fn, calls } = captureFetch(() => jsonResponse(200, { data: SAMPLE_CONFIG, meta: META }));
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    await gate.identityProviders.update("epc_x/../../admin", { enabled: true });
    expect(calls[0]?.url).toBe("https://api.example.test/@member-portal/identity-providers/epc_x%2F..%2F..%2Fadmin");
  });

  it("propagates a gateway error as GateError (e.g. directory pull on a non-google provider)", async () => {
    const { fn } = captureFetch(() =>
      jsonResponse(400, { code: "K9O_INVALID_FIELD_VALUE", message: "directory pull is supported only for idp_provider 'google'", context: { field: "directoryPullEnabled" }, recommendation: null }),
    );
    configureGate({ mode: "standalone", projectSlug: "member-portal", baseUrl: "https://api.example.test", fetch: fn });
    let caught: unknown;
    try {
      await gate.identityProviders.update("epc_abcdef012345", { directoryPullEnabled: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GateError);
  });
});
