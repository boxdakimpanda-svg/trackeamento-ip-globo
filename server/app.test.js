import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp, PRIVACY_VERSION } from "./app.js";
import { createDatabase } from "./database.js";

test("records only consented, minimized visits and protects the dashboard", async (context) => {
  const database = createDatabase(":memory:");
  const app = createApp({
    database,
    geoLookup: async () => ({
      country: "Brasil",
      countryCode: "BR",
      region: "São Paulo",
      regionCode: "SP",
      city: "São Paulo",
      latitude: -23.5505,
      longitude: -46.6333,
      timezone: "America/Sao_Paulo",
      isp: "Example ISP",
      organization: "Example Org",
      asn: "64500",
      network: "IPv4",
    }),
    adminToken: "test-admin-token",
    hashSecret: "test-hash-secret",
    retentionDays: 30,
    trustProxyHops: 1,
    development: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.close();
    database.close();
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const denied = await fetch(`${baseUrl}/api/visits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaign: "denied" }),
  });
  assert.equal(denied.status, 400);

  const campaignResponse = await fetch(`${baseUrl}/api/campaigns`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-admin-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Minha Campanha",
      slug: "minha-campanha",
      destinationUrl: "https://example.com/funil#fragmento",
    }),
  });
  assert.equal(campaignResponse.status, 201);

  const publicCampaign = await fetch(`${baseUrl}/api/campaign/minha-campanha`);
  assert.equal(publicCampaign.status, 200);
  assert.deepEqual(await publicCampaign.json(), {
    slug: "minha-campanha",
    name: "Minha Campanha",
    destinationHost: "example.com",
  });

  const recorded = await fetch(`${baseUrl}/api/visits`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "8.8.8.8",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      consent: true,
      privacyVersion: PRIVACY_VERSION,
      campaign: "Minha Campanha",
      latitude: -23.55052,
      longitude: -46.63331,
      timezone: "America/Sao_Paulo",
      referrer: "https://example.com/path?private=value",
      language: "pt-BR",
      screen: "1920x1080",
      eventKind: "click",
      utm: { source: "meta", medium: "paid-social", campaign: "lancamento" },
    }),
  });
  assert.equal(recorded.status, 201);
  const receipt = await recorded.json();
  assert.equal(receipt.ipMasked, "8.8.8.x");
  assert.equal(receipt.location.latitude, -23.55);
  assert.equal(receipt.location.source, "browser-consent");
  assert.equal(receipt.redirectUrl, "https://example.com/funil");
  assert.equal(JSON.stringify(receipt).includes("8.8.8.8"), false);

  const unauthorized = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(unauthorized.status, 401);

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { authorization: "Bearer test-admin-token" },
  });
  assert.equal(dashboard.status, 200);
  const data = await dashboard.json();
  assert.equal(data.summary.total, 1);
  assert.equal(data.summary.uniqueVisitors, 1);
  assert.equal(data.visits[0].ipMasked, "8.8.8.x");
  assert.equal(data.visits[0].campaign, "minha-campanha");
  assert.equal(data.visits[0].referrer, "https://example.com");
  assert.equal(data.visits[0].isp, "Example ISP");
  assert.equal(data.visits[0].eventKind, "click");
  assert.equal(data.visits[0].utmSource, "meta");
  assert.equal("visitorId" in data.visits[0], false);
});
