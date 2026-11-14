/**
 * Error surface: unknown codes keep their wire code, `requestId` and `publicMessage`, and the `errors` option
 * (`"full"` default, `"redacted"`). Stub fetch only; no network.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, createGateClient, getGateConfig, resetGateConfig, GateError, K9OGateConfigError } from "../src/index.ts";
import { request } from "../src/client.ts";

afterEach(() => {
  resetGateConfig();
});

const REQUEST_ID_HEADER = "x-k9o-request-id";

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const REDIRECT_BODY = {
  code: "K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED",
  message: "x",
  context: { projectSlug: "portal" },
  recommendation: { action: "Register a default redirect" },
};

async function failOf(errors: "full" | "redacted" | undefined, respond: () => Response): Promise<GateError> {
  configureGate({
    mode: "native",
    projectSlug: "test-project",
    baseUrl: "https://api.example.test",
    ...(errors === undefined ? {} : { errors }),
    fetch: (() => Promise.resolve(respond())) as unknown as typeof fetch,
  });
  const caught = await request({ method: "GET", path: "/x" }).then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: unknown) => e,
  );
  expect(caught).toBeInstanceOf(GateError);
  return caught as GateError;
}

describe("unknown codes and requestId (default errors: full)", () => {
  it("(a) keeps the wire code, recommendation, requestId, status and publicMessage on a 503", async () => {
    const err = await failOf(undefined, () => reply(503, REDIRECT_BODY, { [REQUEST_ID_HEADER]: "req_abc" }));
    expect(err.code).toBe("K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED");
    expect(err.status).toBe(503);
    expect(err.recommendation).toBe("Register a default redirect");
    expect(err.requestId).toBe("req_abc");
    expect(err.message).toBe("x");
    expect(err.publicMessage).toBe("Something went wrong. Try again later.");
    expect(err.context["originalCode"]).toBe("K9O_MAGIC_LINK_REDIRECT_NOT_CONFIGURED");
    expect(err.context["projectSlug"]).toBe("portal");
  });

  it("requestId is null when the response has no request-id header", async () => {
    const err = await failOf(undefined, () => reply(503, REDIRECT_BODY));
    expect(err.requestId).toBeNull();
  });

  it("network failure gets the network publicMessage and a null requestId", async () => {
    configureGate({
      mode: "native",
      projectSlug: "test-project",
      baseUrl: "https://api.example.test",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    const err = (await request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as GateError;
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.publicMessage).toBe("Could not reach the service.");
    expect(err.requestId).toBeNull();
  });
});

describe("errors: redacted", () => {
  it("(b) an unknown code becomes INTERNAL_ERROR; message is the publicMessage; recommendation, context and body are dropped; requestId and status kept", async () => {
    const err = await failOf("redacted", () => reply(503, REDIRECT_BODY, { [REQUEST_ID_HEADER]: "req_abc" }));
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe(err.publicMessage);
    expect(err.message).toBe("Something went wrong. Try again later.");
    expect(err.recommendation).toBeNull();
    expect(Object.keys(err.context)).toHaveLength(0);
    expect(err.context["body"]).toBeUndefined();
    expect(err.requestId).toBe("req_abc");
    expect(err.status).toBe(503);
  });

  it("a non-KError body loses its body from context", async () => {
    const err = await failOf("redacted", () => reply(500, { not: "a kerror shape" }));
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.context["body"]).toBeUndefined();
    expect(Object.keys(err.context)).toHaveLength(0);
    expect(err.status).toBe(500);
    expect(err.publicMessage).toBe("Something went wrong. Try again later.");
  });

  it("(c) a known code keeps its code in both modes", async () => {
    const body = { code: "K9O_INVALID_CREDENTIALS", message: "Email or password is wrong.", context: { attempts: 2 } };
    const full = await failOf("full", () => reply(401, body));
    const redacted = await failOf("redacted", () => reply(401, body));
    expect(full.code).toBe("INVALID_CREDENTIALS");
    expect(full.message).toBe("Email or password is wrong.");
    expect(full.context["attempts"]).toBe(2);
    expect(redacted.code).toBe("INVALID_CREDENTIALS");
    expect(redacted.message).toBe("You are not signed in or not allowed to do this.");
    expect(redacted.message).toBe(redacted.publicMessage);
    expect(Object.keys(redacted.context)).toHaveLength(0);
    expect(redacted.status).toBe(401);
  });

  it("(d) a 429 keeps retryAfterSec in redacted mode", async () => {
    const body = {
      code: "K9O_RATE_LIMITED",
      message: "Slow down.",
      recommendation: { retryAfterSec: 30, note: "retry" },
    };
    const err = await failOf("redacted", () => reply(429, body, { [REQUEST_ID_HEADER]: "req_429" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSec).toBe(30);
    expect(err.recommendation).toBeNull();
    expect(err.message).toBe("Too many attempts. Try again later.");
    expect(err.requestId).toBe("req_429");
  });
});

describe("publicMessage by status class", () => {
  const cases: Array<[number, string]> = [
    [401, "You are not signed in or not allowed to do this."],
    [403, "You are not signed in or not allowed to do this."],
    [404, "Not found."],
    [429, "Too many attempts. Try again later."],
    [500, "Something went wrong. Try again later."],
    [599, "Something went wrong. Try again later."],
    [400, "The request could not be completed."],
  ];
  for (const [status, sentence] of cases) {
    it(`status ${status} gives the fixed sentence`, async () => {
      const err = await failOf(undefined, () => reply(status, { code: "K9O_INVALID_FIELD_VALUE", message: "gateway text" }));
      expect(err.publicMessage).toBe(sentence);
      expect(err.message).toBe("gateway text");
    });
  }

  it("a config error, with no status, gets the generic sentence", () => {
    const err = new K9OGateConfigError({ code: "K9O_INVALID_BASE_URL", message: "m", context: { field: "baseUrl" } });
    expect(err.publicMessage).toBe("The request could not be completed.");
  });
});

describe("errors option validation", () => {
  it("(e) an invalid errors value is refused with K9O_INVALID_FIELD_VALUE", () => {
    let caught: unknown = null;
    try {
      createGateClient({
        mode: "native",
        projectSlug: "portal",
        baseUrl: "https://api.example.test",
        errors: "loud" as unknown as "full",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(K9OGateConfigError);
    const err = caught as K9OGateConfigError;
    expect(err.code).toBe("K9O_INVALID_FIELD_VALUE");
    expect(err.context).toEqual({ field: "errors", value: "loud" });
  });

  it("configureGate refuses an invalid errors value too", () => {
    expect(() =>
      configureGate({ mode: "native", projectSlug: "portal", baseUrl: "https://api.example.test", errors: "" as unknown as "full" }),
    ).toThrow(K9OGateConfigError);
  });

  it("the default is full", () => {
    configureGate({ mode: "native", projectSlug: "portal", baseUrl: "https://api.example.test" });
    expect(getGateConfig().errors).toBe("full");
  });
});
