/**
 * `mode.ts` unit tests — configureGate validation + singleton lifecycle.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { configureGate, getGateConfig, resetGateConfig } from "../src/index.ts";

afterEach(() => {
  resetGateConfig();
});

describe("configureGate / getGateConfig", () => {
  it("stores + retrieves the active config", () => {
    configureGate({
      mode: "standalone",
      projectSlug: "partner-console-staging",
      baseUrl: "https://acme.api.example.test",
    });
    const config = getGateConfig();
    expect(config.mode).toBe("standalone");
    expect(config.projectSlug).toBe("partner-console-staging");
    expect(config.baseUrl).toBe("https://acme.api.example.test");
  });

  it("getGateConfig throws when called before configureGate", () => {
    expect(() => getGateConfig()).toThrow(/SDK is not configured/);
  });

  it("rejects invalid modes", () => {
    expect(() =>
      configureGate({
        mode: "hybrid" as unknown as "native",
        projectSlug: "member-portal",
        baseUrl: "https://acme.api.example.test",
      }),
    ).toThrow(/Invalid Gate mode/);
  });

  it("rejects a config missing projectSlug (slug-only addressing)", () => {
    expect(() =>
      configureGate({
        mode: "native",
        baseUrl: "https://acme.api.example.test",
      } as unknown as Parameters<typeof configureGate>[0]),
    ).toThrow(/missing projectSlug/);
  });

  it("rejects empty baseUrl", () => {
    expect(() =>
      configureGate({
        mode: "native",
        projectSlug: "member-portal",
        baseUrl: "",
      }),
    ).toThrow(/Invalid baseUrl/);
  });

  it("resetGateConfig clears the singleton", () => {
    configureGate({
      mode: "native",
      projectSlug: "member-portal",
      baseUrl: "https://acme.api.example.test",
    });
    expect(getGateConfig().mode).toBe("native");
    resetGateConfig();
    expect(() => getGateConfig()).toThrow();
  });

  it("re-configureGate replaces wholesale (no merge)", () => {
    configureGate({
      mode: "standalone",
      projectSlug: "first-project",
      baseUrl: "https://acme.api.example.test",
      partnerToken: "first-token",
    });
    configureGate({
      mode: "native",
      projectSlug: "second-project",
      baseUrl: "https://acme.api.example.test",
    });
    const config = getGateConfig();
    expect(config.mode).toBe("native");
    expect(config.projectSlug).toBe("second-project");
    expect(config.partnerToken).toBeUndefined();
  });
});
