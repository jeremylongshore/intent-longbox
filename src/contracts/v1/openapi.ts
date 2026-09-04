// The OpenAPI document, GENERATED from the Zod contract (042 §2.5(c)).
//
// WHY GENERATED AND NOT WRITTEN. A hand-written spec is 041 §12.2's failure mode
// in document form — "a `file:line` in a decision record is a perishable claim
// about a moving tree" — made about every field and refreshed by nobody. It
// would be wrong within one merge. So: Zod is the source of truth, this file
// derives the artifact, `pnpm contracts:emit` writes it to
// `contracts/openapi.v1.json` — 042 §2.5's own path and script name — and CI
// fails when the committed file differs from the regenerated one (042 I15).
// **The generated file is COMMITTED** so a reviewer sees a contract change as a
// diff in the PR, which is what makes §2.3's additive-only rule reviewable.
//
// WHY A LOCAL CONVERTER AND NOT `zod-to-json-schema`. Adding a dependency was
// available and was not taken: the contract uses eleven Zod constructors, the
// conversion for them is fifty lines, and a lockfile change is a supply-chain
// decision this bead has no mandate to make. The converter THROWS on any
// constructor it does not know (the `default` branch below), so the failure mode
// is a loud build error rather than a silently wrong artifact — which is the
// property that matters, and the one a generic converter would also owe.
import type { z, ZodTypeAny } from "zod";
import { ERROR_CODES, ERROR_CODE_NAMES } from "./errors.js";
import { ROUTES, ROUTE_ALLOWLIST, type RouteSpec } from "./routes.js";

export type JsonSchema = Record<string, unknown>;

interface ZodDefLike {
  typeName: string;
  [key: string]: unknown;
}

function def(schema: ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

/** Zod → JSON Schema for the constructors this contract uses, and no others. */
export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const d = def(schema);
  switch (d.typeName) {
    case "ZodString": {
      const checks = (d["checks"] ?? []) as Array<{ kind: string; value?: number }>;
      const out: JsonSchema = { type: "string" };
      for (const c of checks) {
        if (c.kind === "uuid") out["format"] = "uuid";
        if (c.kind === "min" && typeof c.value === "number") out["minLength"] = c.value;
        if (c.kind === "max" && typeof c.value === "number") out["maxLength"] = c.value;
      }
      return out;
    }
    case "ZodNumber": {
      const checks = (d["checks"] ?? []) as Array<{ kind: string }>;
      return checks.some((c) => c.kind === "int") ? { type: "integer" } : { type: "number" };
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodUnknown":
    case "ZodAny":
      return {};
    case "ZodLiteral":
      return { const: d["value"] };
    case "ZodEnum":
      return { type: "string", enum: [...(d["values"] as string[])] };
    case "ZodArray":
      return { type: "array", items: toJsonSchema(d["type"] as ZodTypeAny) };
    case "ZodRecord":
      return { type: "object", additionalProperties: toJsonSchema(d["valueType"] as ZodTypeAny) };
    case "ZodNullable":
      return { anyOf: [toJsonSchema(d["innerType"] as ZodTypeAny), { type: "null" }] };
    case "ZodOptional":
    case "ZodDefault":
      return toJsonSchema(d["innerType"] as ZodTypeAny);
    case "ZodEffects":
      return toJsonSchema(d["schema"] as ZodTypeAny);
    case "ZodObject": {
      const shape = (schema as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value);
        // `isOptional()` and NOT a typeName check. Zod treats several shapes as
        // optional that are not spelled `ZodOptional` — a bare `z.unknown()` is
        // the one in this contract, and the first version marked every
        // `z.unknown()` REQUIRED. An artifact that says a field must be present
        // when the validator accepts its absence is a contract that lies in the
        // direction a partner would build against.
        if (!value.isOptional()) required.push(key);
      }
      // `additionalProperties: false` is a CLAIM that unknown keys are rejected,
      // and only `.strict()` rejects them — a plain `z.object()` STRIPS them and
      // a passthrough keeps them. Saying false for a stripping schema describes a
      // stricter API than the one that runs, which is how a client learns to fear
      // a field the server would have ignored.
      const strict = d["unknownKeys"] === "strict";
      const out: JsonSchema = {
        type: "object",
        properties,
        ...(strict ? { additionalProperties: false } : {}),
      };
      if (required.length > 0) out["required"] = required;
      return out;
    }
    default:
      throw new Error(
        `openapi: unsupported Zod constructor ${d.typeName}. Add it to toJsonSchema rather than ` +
          `letting the generated artifact describe a fiction (042 §3.3 property 3).`
      );
  }
}

const ERROR_ENVELOPE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "details", "correlation_id", "retryable"],
      properties: {
        code: { type: "string", enum: ERROR_CODE_NAMES },
        message: { type: "string" },
        details: { type: "object" },
        correlation_id: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
  },
};

function pathTemplate(route: RouteSpec): string {
  return route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parametersFor(route: RouteSpec): JsonSchema[] {
  const params: JsonSchema[] = [];
  for (const match of route.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  }
  if (route.mutating) {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description: "Minted when the operator acts, replayed unchanged. Scoped per shop.",
      schema: { type: "string", minLength: 1, maxLength: 200 },
    });
  }
  params.push({
    name: "x-correlation-id",
    in: "header",
    required: false,
    description: "Joins this request to a caller's own trace. Generated when absent.",
    schema: { type: "string" },
  });
  return params;
}

export function buildOpenApiDocument(): JsonSchema {
  const paths: Record<string, JsonSchema> = {};

  for (const route of ROUTES) {
    const template = pathTemplate(route);
    const responses: JsonSchema = {
      [String(route.successStatus)]: {
        description: "Success",
        content: { "application/json": { schema: toJsonSchema(route.response) } },
      },
    };
    for (const code of route.errors) {
      const status = String(ERROR_CODES[code].status);
      const existing = responses[status] as { description: string } | undefined;
      responses[status] = {
        description: existing ? `${existing.description}, ${code}` : code,
        content: { "application/json": { schema: ERROR_ENVELOPE_SCHEMA } },
      };
    }
    const operation: JsonSchema = {
      summary: route.summary,
      parameters: parametersFor(route),
      responses,
    };
    if (route.request) {
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema: toJsonSchema(route.request) } },
      };
    }
    paths[template] = { ...(paths[template] ?? {}), [route.method.toLowerCase()]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Longbox API",
      version: "1.0.0",
      description:
        "The versioned Longbox surface. Within v1, change is ADDITIVE ONLY: a new optional " +
        "request field, a new response field, a new error code or a new route stays in v1; " +
        "removing or renaming a field, making an optional field required, tightening a " +
        "validation rule, or changing what an error code means is v2. A retired code is " +
        "retired forever.",
    },
    // The paths below are absolute and already carry `/api/v1`, so the server
    // is the origin itself: the client is served from the same process (042 §2.2).
    servers: [{ url: "/", description: "Same-origin" }],
    paths,
    components: {
      schemas: { ErrorEnvelope: ERROR_ENVELOPE_SCHEMA },
    },
    "x-longbox-error-registry": Object.fromEntries(
      ERROR_CODE_NAMES.map((code) => [
        code,
        {
          status: ERROR_CODES[code].status,
          retryable: ERROR_CODES[code].retryable,
          operator_renderable: ERROR_CODES[code].operatorRenderable,
          copy_row: ERROR_CODES[code].copyRow,
        },
      ])
    ),
    "x-longbox-route-allowlist": ROUTE_ALLOWLIST.map((row) => ({
      method: row.method,
      path: row.path,
      kind: row.kind,
      reason: row.reason,
      closing_bead: row.closingBead ?? null,
    })),
  };
}

/** The exact bytes `docs/openapi.json` holds. Two writers of one format is one too many. */
export function renderOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
