import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      campaign TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      ip_masked TEXT NOT NULL,
      country TEXT NOT NULL,
      country_code TEXT NOT NULL,
      region TEXT NOT NULL,
      region_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      timezone TEXT NOT NULL,
      browser TEXT NOT NULL,
      os TEXT NOT NULL,
      device TEXT NOT NULL,
      referrer TEXT NOT NULL,
      location_source TEXT NOT NULL,
      isp TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      asn TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      screen TEXT NOT NULL DEFAULT '',
      event_kind TEXT NOT NULL DEFAULT 'pageview',
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      utm_content TEXT NOT NULL DEFAULT '',
      utm_term TEXT NOT NULL DEFAULT '',
      destination_host TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_visits_campaign ON visits(campaign);
    CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id);
    CREATE TABLE IF NOT EXISTS campaigns (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      destination_url TEXT NOT NULL,
      destination_host TEXT NOT NULL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  ensureColumns(database, "visits", {
    region_code: "TEXT NOT NULL DEFAULT ''",
    isp: "TEXT NOT NULL DEFAULT ''",
    organization: "TEXT NOT NULL DEFAULT ''",
    asn: "TEXT NOT NULL DEFAULT ''",
    network: "TEXT NOT NULL DEFAULT ''",
    language: "TEXT NOT NULL DEFAULT ''",
    screen: "TEXT NOT NULL DEFAULT ''",
    event_kind: "TEXT NOT NULL DEFAULT 'pageview'",
    utm_source: "TEXT NOT NULL DEFAULT ''",
    utm_medium: "TEXT NOT NULL DEFAULT ''",
    utm_campaign: "TEXT NOT NULL DEFAULT ''",
    utm_content: "TEXT NOT NULL DEFAULT ''",
    utm_term: "TEXT NOT NULL DEFAULT ''",
    destination_host: "TEXT NOT NULL DEFAULT ''",
  });

  const insert = database.prepare(`
    INSERT INTO visits (
      id, created_at, campaign, visitor_id, ip_masked, country, country_code,
      region, region_code, city, latitude, longitude, timezone, browser, os, device,
      referrer, location_source, isp, organization, asn, network, language,
      screen, event_kind, utm_source, utm_medium, utm_campaign, utm_content,
      utm_term, destination_host
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertCampaign = database.prepare(`
    INSERT INTO campaigns (slug, name, destination_url, destination_host, created_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      destination_url = excluded.destination_url,
      destination_host = excluded.destination_host,
      active = 1
  `);

  return {
    record(visit) {
      insert.run(
        visit.id,
        visit.createdAt,
        visit.campaign,
        visit.visitorId,
        visit.ipMasked,
        visit.country,
        visit.countryCode,
        visit.region,
        visit.regionCode,
        visit.city,
        visit.latitude,
        visit.longitude,
        visit.timezone,
        visit.browser,
        visit.os,
        visit.device,
        visit.referrer,
        visit.locationSource,
        visit.isp,
        visit.organization,
        visit.asn,
        visit.network,
        visit.language,
        visit.screen,
        visit.eventKind,
        visit.utmSource,
        visit.utmMedium,
        visit.utmCampaign,
        visit.utmContent,
        visit.utmTerm,
        visit.destinationHost,
      );
    },

    saveCampaign(campaign) {
      upsertCampaign.run(
        campaign.slug,
        campaign.name,
        campaign.destinationUrl,
        campaign.destinationHost,
        campaign.createdAt,
      );
      return this.getCampaign(campaign.slug);
    },

    getCampaign(slug) {
      const row = database
        .prepare("SELECT slug, name, destination_url, destination_host, created_at, active FROM campaigns WHERE slug = ?")
        .get(slug);
      return row ? campaignRow(row) : null;
    },

    listCampaigns() {
      return database
        .prepare(`
          SELECT c.slug, c.name, c.destination_url, c.destination_host, c.created_at, c.active,
                 COUNT(v.id) AS visits
          FROM campaigns c
          LEFT JOIN visits v ON v.campaign = c.slug
          GROUP BY c.slug
          ORDER BY c.created_at DESC
        `)
        .all()
        .map((row) => ({ ...campaignRow(row), visits: Number(row.visits || 0) }));
    },

    dashboard(days = 30) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const today = new Date().toISOString().slice(0, 10);
      const summary = database
        .prepare(`
          SELECT
            COUNT(*) AS total,
            COUNT(DISTINCT visitor_id) AS unique_visitors,
            COUNT(DISTINCT CASE WHEN country_code <> '' THEN country_code END) AS countries,
            SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END) AS today
          FROM visits
          WHERE created_at >= ?
        `)
        .get(today, cutoff);
      const visits = database
        .prepare(`
          SELECT id, created_at, campaign, ip_masked, country, country_code,
                 region, region_code, city, latitude, longitude, timezone, browser, os,
                 device, referrer, location_source, isp, organization, asn, network,
                 language, screen, event_kind, utm_source, utm_medium, utm_campaign,
                 utm_content, utm_term, destination_host
          FROM visits
          WHERE created_at >= ?
          ORDER BY created_at DESC
          LIMIT 150
        `)
        .all(cutoff);
      const countries = database
        .prepare(`
          SELECT country, country_code, COUNT(*) AS visits
          FROM visits
          WHERE created_at >= ? AND country <> ''
          GROUP BY country, country_code
          ORDER BY visits DESC, country ASC
          LIMIT 8
        `)
        .all(cutoff);
      const daily = database
        .prepare(`
          SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS visits,
                 COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM visits
          WHERE created_at >= ?
          GROUP BY day
          ORDER BY day ASC
        `)
        .all(cutoff);
      const campaigns = database
        .prepare(`
          SELECT campaign, COUNT(*) AS visits
          FROM visits
          WHERE created_at >= ?
          GROUP BY campaign
          ORDER BY visits DESC, campaign ASC
          LIMIT 8
        `)
        .all(cutoff);

      return {
        summary: {
          total: Number(summary.total || 0),
          uniqueVisitors: Number(summary.unique_visitors || 0),
          countries: Number(summary.countries || 0),
          today: Number(summary.today || 0),
        },
        visits: visits.map(toVisit),
        countries: countries.map((row) => ({
          country: row.country,
          countryCode: row.country_code,
          visits: Number(row.visits),
        })),
        daily: daily.map((row) => ({
          day: row.day,
          visits: Number(row.visits),
          uniqueVisitors: Number(row.unique_visitors),
        })),
        campaigns: campaigns.map((row) => ({
          campaign: row.campaign,
          visits: Number(row.visits),
        })),
      };
    },

    purgeOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      return Number(database.prepare("DELETE FROM visits WHERE created_at < ?").run(cutoff).changes);
    },

    close() {
      database.close();
    },
  };
}

function toVisit(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    campaign: row.campaign,
    ipMasked: row.ip_masked,
    country: row.country,
    countryCode: row.country_code,
    region: row.region,
    regionCode: row.region_code,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    browser: row.browser,
    os: row.os,
    device: row.device,
    referrer: row.referrer,
    locationSource: row.location_source,
    isp: row.isp,
    organization: row.organization,
    asn: row.asn,
    network: row.network,
    language: row.language,
    screen: row.screen,
    eventKind: row.event_kind,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    destinationHost: row.destination_host,
  };
}

function ensureColumns(database, table, definitions) {
  const existing = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const [name, definition] of Object.entries(definitions)) {
    if (!existing.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function campaignRow(row) {
  return {
    slug: row.slug,
    name: row.name,
    destinationUrl: row.destination_url,
    destinationHost: row.destination_host,
    createdAt: row.created_at,
    active: Boolean(row.active),
  };
}
