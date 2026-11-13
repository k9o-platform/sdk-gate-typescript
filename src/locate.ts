/**
 * Locating the end user's region for the credential flows.
 *
 * `region.ts` finds the org's regional API host. An end user can live in another region of the project, so password
 * sign-in, one-time-passcode request and verify, and magic-link send first ask the project which region holds the
 * address (`POST /@<projectSlug>/gate/locate { email }` at that regional base) and send the credential to the origin it
 * names. The answer is the same for a known and an unknown address, so it tells a caller nothing about who has an account.
 *
 * Rules:
 *   - The located origin is used for that one attempt. It is not the client's base for other calls and is never cached as
 *     authority. The one thing kept is a hint, per refresh token, so that refresh and sign-out reach the region that
 *     issued the session; a stale hint gets a 401.
 *   - An origin is used only if it is `https` (`http` only when the base is itself `http` on a loopback host), has no
 *     userinfo, port, path, query or fragment, and its host is exactly the base host's org, family and apex with the
 *     region code `[a-z]{2}\d{2}` added or swapped in the service label, and that code equals the answer's `region`.
 *     Anything else, or `origin: null`, means the base is used. A password never goes to a host that fails this.
 *   - The gateway is the authority on regions; a wrong region is a 401.
 */

import { parseApiHost } from "./api-host.ts";
import { requestWith } from "./client.ts";
import { GateError } from "./errors.ts";
import type { GateConfig } from "./mode.ts";
import { resolveRegionalOrigin } from "./region.ts";
import { resolveProjectPathRoot } from "./paths.ts";

const REGION_CODE = /^[a-z]{2}\d{2}$/;

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/**
 * The origin the credential goes to: the located one if it passes the rule, else `base`. Pure; never throws.
 * `answer` is the `data` of the locate envelope.
 */
export function chooseLocatedOrigin(base: string, answer: unknown): string {
  try {
    if (answer === null || typeof answer !== "object") return base;
    const { region, origin } = answer as { region?: unknown; origin?: unknown };
    if (typeof origin !== "string" || typeof region !== "string" || !REGION_CODE.test(region)) return base;
    const b = new URL(base);
    const u = new URL(origin);
    if (u.username !== "" || u.password !== "" || u.port !== "" || u.search !== "" || u.hash !== "") return base;
    if (u.pathname !== "/" || origin.includes("?") || origin.includes("#")) return base;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && b.protocol === "http:" && isLoopback(b.hostname) && isLoopback(u.hostname))) return base;
    if (u.protocol === b.protocol && u.host === b.host) return `${b.protocol}//${b.host}`;
    const from = parseApiHost(b.hostname);
    const to = parseApiHost(u.hostname);
    if (from === null || to === null || to.region !== region) return base;
    if (from.orgSlug !== to.orgSlug || from.family !== to.family || from.apex !== to.apex) return base;
    return `${u.protocol}//${u.host}`;
  } catch {
    return base;
  }
}

/** Ask the project which region holds `email` and return the origin the credential goes to. A 404 from the door means the base; other door errors are thrown. */
export async function locateOrigin(config: GateConfig, email: string): Promise<string> {
  const base = await resolveRegionalOrigin(config);
  try {
    const env = await requestWith<{ region?: unknown; origin?: unknown }>(config, {
      method: "POST",
      path: `${resolveProjectPathRoot(config)}/gate/locate`,
      body: { email },
      anonymous: true,
    });
    return chooseLocatedOrigin(base, env.data);
  } catch (e) {
    // A door that is switched off answers 404: no located origin, so the base is used. Every other failure raises.
    if (e instanceof GateError && e.status === 404) return base;
    throw e;
  }
}

const HINT_LIMIT = 64;
const hints = new Map<string, string>();

/** Remember which origin issued the session with this refresh token (a hint, not authority). */
export function rememberSessionOrigin(refreshToken: string | undefined, origin: string): void {
  if (typeof refreshToken !== "string" || refreshToken.length === 0) return;
  hints.delete(refreshToken);
  hints.set(refreshToken, origin);
  while (hints.size > HINT_LIMIT) hints.delete(hints.keys().next().value as string);
}

export function sessionOriginHint(refreshToken: string): string | undefined {
  return hints.get(refreshToken);
}

export function forgetSessionOrigin(refreshToken: string): void {
  hints.delete(refreshToken);
}
