/**
 * Reads the structure of a gateway API host without knowing its apex.
 *
 * The gateway label is `api` or `api-staging`, optionally followed by `-<rgn>` (a 4-character region code). The label
 * before it is the org slug and whatever follows it is the apex, which is never matched against a list: a public-cloud,
 * internal-apex, air-gapped or localhost deployment all work.
 */

/** The structure of a gateway API host, read from the host itself. */
export type ApiHost = {
  /** First label of an org host (`acme` in `acme.api.corp.internal`); null for a platform host (`api.corp.internal`). */
  orgSlug: string | null;
  /** `api` or `api-staging`: the label that marks a gateway host. */
  family: "api" | "api-staging";
  /** 4-character region code when the host is regional (`api-de01`), else null (region-free). */
  region: string | null;
  /** Everything after the gateway label (`corp.internal`, `k9o.io`). */
  apex: string;
};

const API_LABEL = /^(api|api-staging)(?:-([a-z]{2}\d{2}))?$/;
const SLUG_RE = /^[a-z][a-z0-9-]{1,62}$/;

/**
 * Returns null for any other shape (localhost, an IP, a single-label host, a host with no gateway label), which callers
 * use exactly as given.
 */
export function parseApiHost(host: string): ApiHost | null {
  const labels = host.toLowerCase().split(".");
  if (labels.some((l) => l.length === 0)) return null;
  const mk = (gatewayLabel: string, orgSlug: string | null, rest: string[]): ApiHost | null => {
    const m = API_LABEL.exec(gatewayLabel);
    if (m === null || rest.length === 0) return null;
    return { orgSlug, family: m[1] as "api" | "api-staging", region: m[2] ?? null, apex: rest.join(".") };
  };
  // Org host first: `<org>.<api[-rgn]>.<apex>`.
  if (labels.length >= 3 && SLUG_RE.test(labels[0]!) && !labels[0]!.endsWith("-") && API_LABEL.test(labels[1]!)) {
    return mk(labels[1]!, labels[0]!, labels.slice(2));
  }
  // Platform host: `api.<apex>`.
  if (labels.length >= 2 && API_LABEL.test(labels[0]!)) return mk(labels[0]!, null, labels.slice(1));
  return null;
}
