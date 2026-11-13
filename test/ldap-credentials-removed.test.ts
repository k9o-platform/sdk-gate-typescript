/**
 * The LDAP bind-credential routes are retired (they answer 404), so the SDK must not expose bindings for
 * them: a method that can only ever fail is worse than no method.
 */
import { describe, expect, it } from "bun:test";
import { gate } from "../src/gate.ts";
import * as pkg from "../src/index.ts";

describe("LDAP credential bindings are removed", () => {
  it("gate has no idpProviders namespace", () => {
    expect((gate as Record<string, unknown>)["idpProviders"]).toBeUndefined();
  });
  it("the package exports no LDAP credential factory", () => {
    expect(Object.keys(pkg).filter((k) => /ldap/i.test(k))).toEqual([]);
  });
});
