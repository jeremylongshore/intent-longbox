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
// Keep the existing published projection while upgrading the validator. This
// bounded converter uses Zod 4 schema accessors, preserves the established
// OpenAPI byte contract, and refuses unsupported constructors. The unit and
// contract tests compare required keys with parsing and the emitted artifact
// with the committed document; dependency upgrades must preserve both.
import { z, type ZodTypeAny } from "zod";
import { ERROR_CODES, ERROR_CODE_NAMES } from "./errors.js";
import { ROUTES, ROUTE_ALLOWLIST, type RouteSpec } from "./routes.js";

export type JsonSchema = Record<string, unknown>;

/** Convert the supported contract constructors through Zod 4's schema API. */
export function toJsonSchema(schema: z.core.$ZodType): JsonSchema {
  if (schema instanceof z.ZodString) {
    const out: JsonSchema = { type: "string" };
    if (schema.format === "uuid") out["format"] = "uuid";
    if (schema.minLength !== null) out["minLength"] = schema.minLength;
    if (schema.maxLength !== null) out["maxLength"] = schema.maxLength;
    return out;
  }
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? "integer" : "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return {};
  if (schema instanceof z.ZodLiteral) {
    if (schema.values.size !== 1) throw new Error("openapi: unsupported multi-value literal");
    return { const: [...schema.values][0] };
  }
  if (schema instanceof z.ZodEnum) return { type: "string", enum: [...schema.options] };
  if (schema instanceof z.ZodArray) return { type: "array", items: toJsonSchema(schema.element) };
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: toJsonSchema(schema.valueType) };
  }
  if (schema instanceof z.ZodNullable) {
    return { anyOf: [toJsonSchema(schema.unwrap()), { type: "null" }] };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return toJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodObject) {
    const properties: JsonSchema = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) {
      properties[key] = toJsonSchema(value);
      // Zod 4 accepts undefined as an unknown value but requires a bare unknown
      // object key. Ask the object parser about absence, not value.isOptional().
      if (!z.object({ value }).safeParse({}).success) required.push(key);
    }
    const out: JsonSchema = {
      type: "object",
      properties,
      // A stripping object accepts extra input keys. Only strict rejects them.
      ...(schema.def.catchall instanceof z.ZodNever ? { additionalProperties: false } : {}),
    };
    if (required.length > 0) out["required"] = required;
    return out;
  }
  throw new Error(
    `openapi: unsupported Zod constructor ${schema._zod.def.type}. Add it to toJsonSchema rather than ` +
      `letting the generated artifact describe a fiction (042 §3.3 property 3).`
  );
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
  // The QUERY, for a route whose input arrives in one (E03-B06). Emitted from
  // the same Zod object the handler validates against, so the artifact cannot
  // describe a parameter set the server does not enforce.
  if (route.query) {
    const schema = toJsonSchema(route.query);
    const properties = (schema["properties"] ?? {}) as Record<string, JsonSchema>;
    const required = new Set((schema["required"] ?? []) as string[]);
    for (const [name, propertySchema] of Object.entries(properties)) {
      params.push({ name, in: "query", required: required.has(name), schema: propertySchema });
    }
  }
  // 042 §5.1 CLASS TWO (v1.4.3): a provider callback takes no `Idempotency-Key`,
  // so the document must not declare one as required. Emitting it anyway would
  // describe a header Shopify cannot send and this server does not demand —
  // §3.3 property 3's fiction, in the one place a partner would build against
  // it. The exemption is a declared field on the route, never an inference from
  // the method.
  if (route.mutating && route.idempotency === undefined) {
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
    // A route that streams bytes declares `response: null` and its media type.
    // `string/binary` is OpenAPI's own spelling for "the body is the file"; the
    // alternative — inventing a Zod object for a photograph — would put a
    // fiction in the artifact, which is the failure the converter's throwing
    // `default` branch exists to prevent.
    const successMediaType = route.responseMediaType ?? "application/json";
    const successSchema = route.response
      ? toJsonSchema(route.response)
      : { type: "string", format: "binary" };
    const responses: JsonSchema = {
      [String(route.successStatus)]: {
        description: "Success",
        content: { [successMediaType]: { schema: successSchema } },
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
