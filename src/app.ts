import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import type { AppConfig } from "./config.js";
import { registerScanSessionRoutes } from "./routes/scanSessions.js";

export async function buildApp(db: pg.Pool, config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Never log request bodies or headers (keys travel in neither, but belt-and-braces).
      redact: ["req.headers.authorization", "req.headers['x-api-key']"],
    },
  });

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: join(process.cwd(), "public"), prefix: "/" });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), config.uploadsDir),
    prefix: `/${config.uploadsDir}/`,
    decorateReply: false,
  });

  app.get("/healthz", async () => ({ ok: true }));

  registerScanSessionRoutes(app, db, config);

  return app;
}
