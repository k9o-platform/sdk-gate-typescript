/**
 * A Gate client whose network is a recorder: every request the SDK sends is captured (method, path, query, JSON body) and
 * answered with an empty success envelope. The contract test calls each Gate method through it and compares what was
 * actually sent against the gateway's OpenAPI.
 */
import { createGateClient, type GateClient } from "../../src/index.ts";

export type Sent = { method: string; path: string; query: string[]; body: unknown };

export function recordingGate(): { client: GateClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    // The client probes a region-free host (HEAD /) to learn the regional one; that is not an API call.
    if ((init?.method ?? "GET") === "HEAD" && url.pathname === "/") return new Response(null, { status: 200 });
    sent.push({ method: String(init?.method ?? "GET"), path: url.pathname, query: [...url.searchParams.keys()], body });
    return new Response(JSON.stringify({ data: { authorizationUrl: "https://idp.example/authorize" }, meta: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  const client = createGateClient({
    mode: "native",
    baseUrl: "https://acme.api.example.test",
    projectSlug: "demo-app",
    partnerToken: "k9o_test",
    fetch: fetchImpl,
  });
  return { client, sent };
}
