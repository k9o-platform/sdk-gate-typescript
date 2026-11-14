/**
 * `orgSlug` as an alternative to `baseUrl`: URL resolution rules.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, createGateClient, getGateConfig, resetGateConfig, GateError, K9OGateConfigError } from "../src/index.ts";

afterEach(() => {
  resetGateConfig();
});

const base = { mode: "native", projectSlug: "member-portal" } as const;

function resolved(baseUrl?: string, orgSlug?: string): string {
  configureGate({
    ...base,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(orgSlug !== undefined ? { orgSlug } : {}),
  });
  return getGateConfig().baseUrl;
}

describe("orgSlug resolution", () => {
  it("uses a full org URL as given, with or without a slug", () => {
    expect(resolved("https://acme.api.example.test")).toBe("https://acme.api.example.test");
    expect(resolved("https://acme.api.example.test", "other")).toBe("https://acme.api.example.test");
  });

  it("uses a custom domain as given, with or without a slug", () => {
    expect(resolved("https://auth.example.com")).toBe("https://auth.example.com");
    expect(resolved("https://auth.example.com", "acme")).toBe("https://auth.example.com");
  });

  it("uses localhost and IP hosts as given, even with a slug", () => {
    expect(resolved("http://localhost:3000", "acme")).toBe("http://localhost:3000");
    expect(resolved("http://127.0.0.1:8080", "acme")).toBe("http://127.0.0.1:8080");
  });

  it("composes the org host from a platform host and a slug", () => {
    expect(resolved("https://api.example.test", "acme")).toBe("https://acme.api.example.test");
    expect(resolved("http://api.corp.internal:8443", "acme")).toBe("http://acme.api.corp.internal:8443");
  });

  it("leaves a platform host alone when there is no slug", () => {
    expect(resolved("https://api.example.test")).toBe("https://api.example.test");
  });

  it("uses a regional platform host as given", () => {
    expect(resolved("https://api-de01.example.test", "acme")).toBe("https://api-de01.example.test");
  });

  it("slug only goes to https://<slug>.api.k9o.io", () => {
    expect(resolved(undefined, "acme")).toBe("https://acme.api.k9o.io");
  });

  it("rejects a bad slug", () => {
    for (const slug of ["Acme", "acme-", "a", "a".repeat(64)]) {
      let err: unknown;
      try {
        resolved(undefined, slug);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(K9OGateConfigError);
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("K9O_INVALID_FIELD_VALUE");
      expect((err as GateError).context).toEqual({ field: "orgSlug", slug });
    }
    expect(() => resolved("https://api.example.test", "Acme")).toThrow(K9OGateConfigError);
  });

  it("rejects neither baseUrl nor orgSlug", () => {
    for (const make of [() => configureGate({ ...base }), () => createGateClient({ ...base })]) {
      let err: unknown;
      try {
        make();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(K9OGateConfigError);
      expect((err as K9OGateConfigError).code).toBe("K9O_INVALID_BASE_URL");
      expect((err as K9OGateConfigError).context).toEqual({ field: "baseUrl" });
    }
  });

  it("sends a request to the composed host", async () => {
    let seenUrl = "";
    const client = createGateClient({
      ...base,
      orgSlug: "acme",
      fetch: ((url: string) => {
        seenUrl = url;
        return Promise.resolve(
          new Response(JSON.stringify({ data: { user: null }, meta: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as unknown as typeof fetch,
    });
    await client.whoami().catch(() => undefined);
    expect(seenUrl.startsWith("https://acme.api.k9o.io/@member-portal/gate/")).toBe(true);
  });
});
