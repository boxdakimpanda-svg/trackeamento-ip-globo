import type { AppConfig, Campaign, DashboardData, LookupResult } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.message || "Não foi possível completar a solicitação.", response.status, data.error);
  }
  return data as T;
}

export function getConfig() {
  return request<AppConfig>("/api/config");
}

export function getDashboard(token: string, days: number) {
  return request<DashboardData>(`/api/dashboard?days=${days}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export function lookupIp(token: string, ip: string) {
  return request<LookupResult>(`/api/lookup?ip=${encodeURIComponent(ip)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export function getCampaign(slug: string) {
  return request<Campaign>(`/api/campaign/${encodeURIComponent(slug)}`);
}

export function getCampaigns(token: string) {
  return request<{ campaigns: Campaign[] }>("/api/campaigns", {
    headers: { authorization: `Bearer ${token}` },
  });
}

export function saveCampaign(token: string, input: { name: string; slug: string; destinationUrl: string }) {
  return request<{ campaign: Campaign }>("/api/campaigns", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function registerVisit(body: Record<string, unknown>) {
  return request<{
    id: string;
    recordedAt: string;
    ipMasked: string;
    location: {
      country: string;
      region: string;
      city: string;
      latitude: number | null;
      longitude: number | null;
      source: string;
    };
    retentionDays: number;
    redirectUrl: string | null;
  }>("/api/visits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
