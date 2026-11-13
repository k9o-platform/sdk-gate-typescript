import { describe, expect, it } from "bun:test";
import { parseApiHost, regionalOriginFromLocation, resolveRegionalOrigin } from "../src/index.ts";

function probeFetch(location: string | null) {
  const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
    return location === null ? new Response(null, { status: 200 }) : new Response(null, { status: 308, headers: { location } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}

describe("parseApiHost", () => {
  it("reads org, family, region and apex from any apex", () => {
    expect(parseApiHost("acme.api.example.test")).toEqual({ orgSlug: "acme", family: "api", region: null, apex: "example.test" });
    expect(parseApiHost("acme.api-de01.corp.internal")).toEqual({ orgSlug: "acme", family: "api", region: "de01", apex: "corp.internal" });
    expect(parseApiHost("acme.api-staging.example.org")).toEqual({ orgSlug: "acme", family: "api-staging", region: null, apex: "example.org" });
    expect(parseApiHost("api.corp.internal")).toEqual({ orgSlug: null, family: "api", region: null, apex: "corp.internal" });
  });

  it("returns null for localhost, IPs and non-gateway hosts", () => {
    expect(parseApiHost("localhost")).toBeNull();
    expect(parseApiHost("127.0.0.1")).toBeNull();
    expect(parseApiHost("gateway.corp.internal")).toBeNull();
  });
});

describe("regional origin", () => {
  it("follows the 308 for an unrelated apex (no k9o.io anywhere)", async () => {
    const { fetch, seen } = probeFetch("https://acme.api-de01.corp.internal/");
    const origin = await resolveRegionalOrigin({ baseUrl: "https://acme.api.corp.internal", fetch });
    expect(origin).toBe("https://acme.api-de01.corp.internal");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("HEAD");
    expect(Object.keys(seen[0]!.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  it("uses localhost exactly as given and never probes", async () => {
    const { fetch, seen } = probeFetch("https://evil.example/");
    expect(await resolveRegionalOrigin({ baseUrl: "http://localhost:8080", fetch })).toBe("http://localhost:8080");
    expect(seen).toHaveLength(0);
  });

  it("uses an already-regional host as given", async () => {
    const { fetch, seen } = probeFetch("https://x.example/");
    expect(await resolveRegionalOrigin({ baseUrl: "https://acme.api-de01.corp.internal", fetch })).toBe("https://acme.api-de01.corp.internal");
    expect(seen).toHaveLength(0);
  });

  it("ignores a Location for another org, another apex, a port, or plain http", () => {
    const host = "acme.api.corp.internal";
    const base = `https://${host}`;
    expect(regionalOriginFromLocation(host, "https://acme.api-de01.corp.internal/", base)).toBe("https://acme.api-de01.corp.internal");
    expect(regionalOriginFromLocation(host, "https://other.api-de01.corp.internal/", base)).toBeNull();
    expect(regionalOriginFromLocation(host, "https://acme.api-de01.evil.example/", base)).toBeNull();
    expect(regionalOriginFromLocation(host, "https://acme.api-de01.corp.internal:8443/", base)).toBeNull();
    expect(regionalOriginFromLocation(host, "http://acme.api-de01.corp.internal/", base)).toBeNull();
    expect(regionalOriginFromLocation(host, "https://acme.api-staging-de01.corp.internal/", base)).toBeNull();
  });

  it("keeps the configured origin when the host answers directly", async () => {
    const { fetch } = probeFetch(null);
    expect(await resolveRegionalOrigin({ baseUrl: "https://acme.api.corp.internal", fetch })).toBe("https://acme.api.corp.internal");
  });
});
