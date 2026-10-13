import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";
import { createGeoLookup } from "./geo.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const development = process.env.NODE_ENV !== "production";
const adminToken = process.env.ATLAS_ADMIN_TOKEN || (development ? "atlas-dev" : "");
const hashSecret = process.env.ATLAS_HASH_SECRET || adminToken || randomBytes(32).toString("hex");
const retentionDays = numberBetween(process.env.ATLAS_RETENTION_DAYS, 30, 1, 365);
const trustProxyHops = numberBetween(process.env.ATLAS_TRUST_PROXY_HOPS, 1, 0, 5);
const databasePath = process.env.ATLAS_DB_PATH || join(projectRoot, ".data", "atlas.sqlite");
const geoIpUrl = Object.hasOwn(process.env, "ATLAS_GEOIP_URL") ? process.env.ATLAS_GEOIP_URL : "https://ipwho.is";
const database = createDatabase(databasePath);
const app = createApp({
  database,
  geoLookup: createGeoLookup({ baseUrl: geoIpUrl }),
  adminToken,
  hashSecret,
  retentionDays,
  trustProxyHops,
  development,
});

let vite;
if (development) {
  const { createServer } = await import("vite");
  vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const dist = join(projectRoot, "dist");
  if (!existsSync(dist)) {
    console.error("Build ausente. Execute npm run build antes de iniciar em produção.");
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((_request, response) => response.sendFile(join(dist, "index.html")));
}

const port = numberBetween(process.env.PORT, 3000, 1, 65_535);
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`Atlas IP disponível em http://${host}:${port}`);
  if (development) console.log(`Painel local: use a chave ${adminToken}`);
  if (!adminToken) console.warn("ATLAS_ADMIN_TOKEN não definido; o painel administrativo permanecerá bloqueado.");
});

async function shutdown() {
  server.close();
  database.close();
  if (vite) await vite.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function numberBetween(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
