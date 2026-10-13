import express from "express";
import { randomUUID } from "node:crypto";
import {
  anonymousVisitorId,
  isPublicIp,
  maskIp,
  normalizeIp,
  parseUserAgent,
  roundCoordinate,
  safeText,
  tokensMatch,
} from "./privacy.js";

export const PRIVACY_VERSION = "2026-10-13";

export function createApp({
  database,
  geoLookup,
  adminToken = "",
  hashSecret = "atlas-development-only",
  retentionDays = 30,
  trustProxyHops = 1,
  development = false,
}) {
  const app = express();
  const buckets = new Map();

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxyHops);
  app.use(express.json({ limit: "24kb" }));
  app.use((request, response, next) => {
    response.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://tiles.openfreemap.org https://server.arcgisonline.com",
        "font-src 'self'",
        `connect-src 'self'${development ? " ws:" : ""} https://tiles.openfreemap.org https://server.arcgisonline.com https://tiles.mapterhorn.com`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    });
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "atlas-ip", privacyVersion: PRIVACY_VERSION });
  });

  app.get("/api/config", (_request, response) => {
    response.json({
      adminConfigured: Boolean(adminToken),
      development,
      developmentTokenHint: development ? adminToken : undefined,
      retentionDays,
      privacyVersion: PRIVACY_VERSION,
    });
  });

  app.get("/api/campaign/:slug", (request, response) => {
    const campaign = database.getCampaign(campaignName(request.params.slug));
    if (!campaign || !campaign.active) {
      return response.status(404).json({ error: "CAMPAIGN_NOT_FOUND", message: "Campanha não encontrada." });
    }
    return response.json({
      slug: campaign.slug,
      name: campaign.name,
      destinationHost: campaign.destinationHost,
    });
  });

  app.get("/api/me", rateLimit(buckets, 60, 60_000), async (request, response) => {
    const ip = requestIp(request);
    const geo = await geoLookup(ip);
    response.json({
      ipMasked: maskIp(ip),
      isPublic: isPublicIp(ip),
      ...geo,
    });
  });

  app.get("/api/search", rateLimit(buckets, 15, 60_000), async (request, response) => {
    const query = safeText(request.query.q, 120);
    if (query.length < 2) {
      return response.status(400).json({ error: "INVALID_QUERY", message: "Informe uma cidade ou endereço válido." });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.search = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "5",
        "accept-language": "pt-BR",
      }).toString();
      const result = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Atlas-IP/1.0 (geographic dashboard)" },
        signal: controller.signal,
      });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const data = await result.json();
      return response.json({
        results: Array.isArray(data) ? data.flatMap((entry) => {
          const latitude = Number(entry.lat);
          const longitude = Number(entry.lon);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
          return [{
            displayName: safeText(entry.display_name, 220, "Local encontrado"),
            latitude,
            longitude,
            type: safeText(entry.type, 30, "place"),
          }];
        }) : [],
      });
    } catch {
      return response.status(502).json({ error: "SEARCH_UNAVAILABLE", message: "A busca geográfica está indisponível no momento." });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post("/api/visits", rateLimit(buckets, 10, 60_000), async (request, response) => {
    if (request.body?.consent !== true || request.body?.privacyVersion !== PRIVACY_VERSION) {
      return response.status(400).json({
        error: "CONSENT_REQUIRED",
        message: "É necessário consentimento explícito para registrar a visita.",
      });
    }

    const latitude = validCoordinate(request.body.latitude, -90, 90);
    const longitude = validCoordinate(request.body.longitude, -180, 180);
    if ((latitude === null) !== (longitude === null)) {
      return response.status(400).json({ error: "INVALID_LOCATION", message: "Coordenadas incompletas." });
    }

    const ip = requestIp(request);
    const geo = await geoLookup(ip);
    const userAgent = parseUserAgent(request.get("user-agent"));
    const browserLocation = latitude !== null && longitude !== null;
    const campaignSlug = campaignName(request.body.campaign);
    const campaign = database.getCampaign(campaignSlug);
    const utm = request.body.utm && typeof request.body.utm === "object" ? request.body.utm : {};
    const visit = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      campaign: campaignSlug,
      visitorId: anonymousVisitorId(ip, hashSecret),
      ipMasked: maskIp(ip),
      country: geo.country || "Não identificado",
      countryCode: geo.countryCode,
      region: geo.region,
      regionCode: geo.regionCode || "",
      city: geo.city,
      latitude: browserLocation ? latitude : roundCoordinate(geo.latitude),
      longitude: browserLocation ? longitude : roundCoordinate(geo.longitude),
      timezone: safeText(request.body.timezone, 64, geo.timezone),
      browser: userAgent.browser,
      os: userAgent.os,
      device: userAgent.device,
      referrer: safeReferrer(request.body.referrer),
      locationSource: browserLocation ? "browser-consent" : geo.latitude !== null ? "ip-approximate" : "unavailable",
      isp: geo.isp || "",
      organization: geo.organization || "",
      asn: geo.asn || "",
      network: geo.network || "",
      language: safeText(request.body.language, 24),
      screen: safeText(request.body.screen, 24),
      eventKind: eventKind(request.body.eventKind),
      utmSource: safeText(utm.source, 80),
      utmMedium: safeText(utm.medium, 80),
      utmCampaign: safeText(utm.campaign, 100),
      utmContent: safeText(utm.content, 100),
      utmTerm: safeText(utm.term, 100),
      destinationHost: campaign?.destinationHost || "",
    };

    database.purgeOlderThan(retentionDays);
    database.record(visit);
    return response.status(201).json({
      id: visit.id,
      recordedAt: visit.createdAt,
      ipMasked: visit.ipMasked,
      location: {
        country: visit.country,
        region: visit.region,
        city: visit.city,
        latitude: visit.latitude,
        longitude: visit.longitude,
        source: visit.locationSource,
      },
      retentionDays,
      redirectUrl: campaign?.active ? campaign.destinationUrl : null,
    });
  });

  app.get("/api/dashboard", requireAdmin(adminToken), (request, response) => {
    const days = [1, 7, 30, 90].includes(Number(request.query.days)) ? Number(request.query.days) : 30;
    response.json({ ...database.dashboard(days), rangeDays: days, generatedAt: new Date().toISOString() });
  });

  app.get("/api/campaigns", requireAdmin(adminToken), (_request, response) => {
    response.json({ campaigns: database.listCampaigns() });
  });

  app.post("/api/campaigns", requireAdmin(adminToken), rateLimit(buckets, 30, 60_000), (request, response) => {
    const name = safeText(request.body?.name, 80);
    const slug = campaignName(request.body?.slug || name);
    const destination = parseDestination(request.body?.destinationUrl, development);
    if (!name || !slug || !destination) {
      return response.status(400).json({
        error: "INVALID_CAMPAIGN",
        message: "Informe nome, identificador e uma URL HTTPS válida para o funil.",
      });
    }
    const campaign = database.saveCampaign({
      slug,
      name,
      destinationUrl: destination.toString(),
      destinationHost: destination.host,
      createdAt: new Date().toISOString(),
    });
    return response.status(201).json({ campaign });
  });

  app.get("/api/lookup", requireAdmin(adminToken), rateLimit(buckets, 30, 60_000), async (request, response) => {
    const ip = normalizeIp(request.query.ip);
    if (!isPublicIp(ip)) {
      return response.status(400).json({
        error: "INVALID_IP",
        message: "Informe um endereço IP público válido.",
      });
    }
    const geo = await geoLookup(ip);
    response.json({ ipMasked: maskIp(ip), ...geo, approximate: true });
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "NOT_FOUND", message: "Endpoint não encontrado." });
  });

  app.use((error, _request, response, _next) => {
    if (error?.type === "entity.too.large") {
      return response.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    }
    console.error("Atlas request failed", error?.message || error);
    return response.status(500).json({ error: "INTERNAL_ERROR", message: "Falha interna inesperada." });
  });

  return app;
}

function requestIp(request) {
  return normalizeIp(request.ip || request.socket?.remoteAddress || "");
}

function campaignName(value) {
  const cleaned = safeText(value, 48, "direto")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "direto";
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return roundCoordinate(number);
}

function safeReferrer(value) {
  const input = safeText(value, 240);
  if (!input) return "direto";
  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}`.slice(0, 160);
  } catch {
    return "direto";
  }
}

function eventKind(value) {
  const kind = safeText(value, 24, "pageview").toLowerCase();
  return ["pageview", "click", "lead", "checkout", "purchase", "conversion"].includes(kind) ? kind : "pageview";
}

function parseDestination(value, development) {
  try {
    const url = new URL(String(value || ""));
    const localDevelopment = development && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localDevelopment) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function requireAdmin(expected) {
  return (request, response, next) => {
    if (!expected) {
      return response.status(503).json({
        error: "ADMIN_NOT_CONFIGURED",
        message: "Defina ATLAS_ADMIN_TOKEN no servidor antes de abrir o painel.",
      });
    }
    const authorization = request.get("authorization") || "";
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!tokensMatch(provided, expected)) {
      return response.status(401).json({ error: "UNAUTHORIZED", message: "Chave administrativa inválida." });
    }
    next();
  };
}

function rateLimit(buckets, maximum, windowMs) {
  return (request, response, next) => {
    const now = Date.now();
    const key = `${requestIp(request)}:${request.path}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maximum) {
      response.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return response.status(429).json({ error: "RATE_LIMITED", message: "Muitas solicitações. Tente novamente em instantes." });
    }
    if (buckets.size > 2_000) {
      for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
    }
    next();
  };
}
