import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function normalizeIp(value = "") {
  const first = String(value).split(",", 1)[0].trim();
  if (first.startsWith("::ffff:")) return first.slice(7);
  if (first === "::1") return "127.0.0.1";
  return first;
}

export function isPublicIp(value) {
  const ip = normalizeIp(value);
  const version = isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false;
    return true;
  }

  const lower = ip.toLowerCase();
  return !(
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8")
  );
}

export function maskIp(value) {
  const ip = normalizeIp(value);
  if (isIP(ip) === 4) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (isIP(ip) === 6) {
    const [leftText, rightText = ""] = ip.split("::");
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    const parts = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right].slice(0, 4);
    while (parts.at(-1) === "0") parts.pop();
    return `${parts.join(":")}::`;
  }
  return "indisponível";
}

export function anonymousVisitorId(ip, secret) {
  return createHmac("sha256", secret).update(normalizeIp(ip)).digest("hex").slice(0, 20);
}

export function safeText(value, maxLength = 80, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) || fallback;
}

export function roundCoordinate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function parseUserAgent(value = "") {
  const ua = String(value);
  let browser = "Outro";
  let os = "Outro";
  let device = "Desktop";

  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  if (/iPad|Tablet/i.test(ua)) device = "Tablet";
  else if (/Mobile|Android|iPhone|iPod/i.test(ua)) device = "Mobile";

  return { browser, os, device };
}

export function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
