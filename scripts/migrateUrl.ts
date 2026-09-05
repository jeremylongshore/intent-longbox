// Which connection string a schema-owning script uses (E02-D06, 041 §9.2 item 2).
//
// `MIGRATE_DATABASE_URL` names the role that OWNS the schema; `DATABASE_URL`
// names the application role, which owns nothing and cannot disable a trigger.
// Two scripts create or seed rows as the owner — `migrate.ts` and
// `register-shop.ts` — and both resolve their URL here so the rule is spelled
// once.
//
// THE FALLBACK IS A DEV CONVENIENCE AND IS LOUD ABOUT IT. An existing local
// checkout has one DATABASE_URL and no roles provisioned; making this a hard
// error would break `pnpm migrate` for anyone who has not read the changelog
// yet. In production it IS a hard error: falling back there means the migration
// ran as whatever role the server uses, which re-merges the two roles and
// silently undoes the separation. NODE_ENV is the discriminator because it is
// the one this repo already sets in a deployment.

/** Resolve the schema-owner connection string, or throw with the fix. */
export function resolveMigrateUrl(): string {
  const migrateUrl = process.env["MIGRATE_DATABASE_URL"];
  if (migrateUrl) return migrateUrl;

  const appUrl = process.env["DATABASE_URL"];
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "MIGRATE_DATABASE_URL is not set. In production the migration runner must connect as the " +
        "schema-owning role (longbox_migrate), never as the application role in DATABASE_URL — " +
        "running migrations as the app role makes it the owner of every table, and an owner can " +
        "ALTER TABLE … DISABLE TRIGGER on the append-only guarantee (041 §9.2 item 2)."
    );
  }
  if (!appUrl) throw new Error("neither MIGRATE_DATABASE_URL nor DATABASE_URL is set");

  console.warn(
    "[migrate] WARNING: MIGRATE_DATABASE_URL is not set; falling back to DATABASE_URL. " +
      "The role that runs migrations OWNS every table and can disable the append-only triggers, " +
      "so the server will refuse to boot on this connection once role separation is provisioned. " +
      "Provision two roles (docker/postgres-init/00-roles.sql) and set both variables — see .env.example. " +
      "This fallback is refused when NODE_ENV=production."
  );
  return appUrl;
}
