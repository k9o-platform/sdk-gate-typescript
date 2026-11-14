/**
 * Contract test: every @k9o/gate call, sent through a recording client, must hit a route the gateway serves and send a body
 * that route reads. The gateway's emitted OpenAPI is the source of truth. `broken` calls are known disagreements; they must
 * keep failing so a fix cannot go unnoticed.
 */
import { describe, expect, it } from "bun:test";
import { checkBody, findOperation, methodsFor } from "../../../core/test/contract/openapi.ts";
import { CALLS, type CallEntry } from "./calls.ts";
import { recordingGate } from "./recorder.ts";

async function verdict(entry: CallEntry): Promise<string[]> {
  const { client, sent } = recordingGate();
  try {
    await entry.call(client);
  } catch (e) {
    if (sent.length === 0) return [`the call threw before sending: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (sent.length === 0) return ["the call sent no request"];
  const problems: string[] = [];
  for (const req of sent) {
    const op = findOperation(req.method, req.path);
    if (!op) {
      const other = methodsFor(req.path);
      problems.push(other.length > 0 ? `${req.method} ${req.path}: the route exists for ${other.join("/")} only` : `${req.method} ${req.path}: no such route`);
      continue;
    }
    const schema = op.body ?? entry.contract ?? null;
    if (req.method !== "GET" && req.method !== "DELETE" && schema === null && req.body !== undefined) {
      problems.push(`${req.method} ${op.template}: the route declares no body and the call sends one`);
      continue;
    }
    if (schema) problems.push(...checkBody(schema, req.body).map((m) => `${req.method} ${op.template}: ${m}`));
    if (op.query.length > 0) for (const q of req.query) if (!op.query.includes(q)) problems.push(`${req.method} ${op.template}: query '${q}' is not declared by the route`);
  }
  return problems;
}

describe("@k9o/gate against the gateway OpenAPI", () => {
  for (const entry of CALLS) {
    it(entry.id, async () => {
      const problems = await verdict(entry);
      if (entry.broken) {
        expect(problems.length, `${entry.id} is listed as broken (${entry.broken}) but now passes: remove its 'broken' mark`).toBeGreaterThan(0);
      } else {
        expect(problems, `${entry.id} disagrees with the gateway`).toEqual([]);
      }
    });
  }

  it("the table covers every method of the gate namespace", () => {
    const { client } = recordingGate();
    const names: string[] = [];
    const walk = (o: Record<string, unknown>, prefix: string) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "function") names.push(`${prefix}${k}`);
        else if (v !== null && typeof v === "object") walk(v as Record<string, unknown>, `${prefix}${k}.`);
      }
    };
    walk(client as unknown as Record<string, unknown>, "gate.");
    // Pure helpers with no route.
    const local = new Set(["gate.passwordless.parseMagicLinkCallback"]);
    const covered = new Set(CALLS.map((c) => c.id));
    expect(names.filter((n) => !local.has(n) && !covered.has(n))).toEqual([]);
  });
});
