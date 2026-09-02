// Central env-derived config. Secrets stay in process.env; this module never
// logs or re-exports raw key values beyond handing them to transport code.
import "dotenv/config";

export interface BandThresholds {
  high: number;
  medium: number;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  uploadsDir: string;
  bands: BandThresholds;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`env ${name} is not a number`);
  return n;
}

export function loadConfig(): AppConfig {
  return {
    port: num("PORT", 3000),
    databaseUrl: process.env.DATABASE_URL ?? "",
    uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
    bands: {
      high: num("BAND_HIGH", 0.85),
      medium: num("BAND_MEDIUM", 0.5),
    },
  };
}

// Pinned per-MTok USD price table for cost estimation (R13). Tunable in code,
// deliberately not env-driven: a price change is a reviewed commit.
export const PRICE_TABLE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "gpt-4o": { in: 2.5, out: 10 },
};

export function estimateUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE_TABLE_PER_MTOK[model];
  if (!p) return 0;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
