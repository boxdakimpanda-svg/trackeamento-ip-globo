import { isPublicIp } from "./privacy.js";

export function createGeoLookup({ baseUrl = "https://ipwho.is", timeoutMs = 3500 } = {}) {
  const cache = new Map();

  return async function lookup(ip) {
    if (!isPublicIp(ip) || !baseUrl) return emptyGeo();
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(ip)}`, {
        headers: { accept: "application/json", "user-agent": "Atlas-IP/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) return emptyGeo();
      const data = await response.json();
      if (data.success === false) return emptyGeo();
      const value = {
        country: text(data.country),
        countryCode: text(data.country_code, 4).toUpperCase(),
        region: text(data.region),
        regionCode: text(data.region_code, 12).toUpperCase(),
        city: text(data.city),
        latitude: coordinate(data.latitude, -90, 90),
        longitude: coordinate(data.longitude, -180, 180),
        timezone: text(data.timezone?.id || data.timezone),
        isp: text(data.connection?.isp || data.isp, 100),
        organization: text(data.connection?.org || data.organization, 120),
        asn: text(data.connection?.asn || data.asn, 24).replace(/^AS/i, ""),
        network: text(data.type || data.connection?.type, 32),
      };
      cache.set(ip, { value, expiresAt: Date.now() + 3_600_000 });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return emptyGeo();
    } finally {
      clearTimeout(timer);
    }
  };
}

function text(value, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function coordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function emptyGeo() {
  return {
    country: "",
    countryCode: "",
    region: "",
    regionCode: "",
    city: "",
    latitude: null,
    longitude: null,
    timezone: "",
    isp: "",
    organization: "",
    asn: "",
    network: "",
  };
}
