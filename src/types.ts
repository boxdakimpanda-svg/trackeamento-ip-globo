export type AppConfig = {
  adminConfigured: boolean;
  development: boolean;
  developmentTokenHint?: string;
  retentionDays: number;
  privacyVersion: string;
};

export type Visit = {
  id: string;
  createdAt: string;
  campaign: string;
  ipMasked: string;
  country: string;
  countryCode: string;
  region: string;
  regionCode: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  browser: string;
  os: string;
  device: string;
  referrer: string;
  locationSource: "browser-consent" | "ip-approximate" | "unavailable";
  isp: string;
  organization: string;
  asn: string;
  network: string;
  language: string;
  screen: string;
  eventKind: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  destinationHost: string;
};

export type Campaign = {
  slug: string;
  name: string;
  destinationUrl?: string;
  destinationHost: string;
  createdAt?: string;
  active?: boolean;
  visits?: number;
};

export type DashboardData = {
  summary: {
    total: number;
    uniqueVisitors: number;
    countries: number;
    today: number;
  };
  visits: Visit[];
  countries: Array<{ country: string; countryCode: string; visits: number }>;
  daily: Array<{ day: string; visits: number; uniqueVisitors: number }>;
  campaigns: Array<{ campaign: string; visits: number }>;
  rangeDays: number;
  generatedAt: string;
};

export type LookupResult = {
  ipMasked: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  approximate: boolean;
};
