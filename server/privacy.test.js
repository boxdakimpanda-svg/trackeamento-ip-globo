import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymousVisitorId,
  isPublicIp,
  maskIp,
  normalizeIp,
  parseUserAgent,
  roundCoordinate,
  tokensMatch,
} from "./privacy.js";

test("normalizes and masks IPv4 and IPv6 addresses", () => {
  assert.equal(normalizeIp("::ffff:203.0.113.42"), "203.0.113.42");
  assert.equal(maskIp("8.8.8.8"), "8.8.8.x");
  assert.equal(maskIp("2001:4860:4860::8888"), "2001:4860:4860::");
});

test("rejects local and reserved ranges for external lookup", () => {
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("192.168.1.2"), false);
  assert.equal(isPublicIp("203.0.113.4"), false);
  assert.equal(isPublicIp("8.8.8.8"), true);
});

test("creates stable, secret-bound anonymous visitor identifiers", () => {
  const first = anonymousVisitorId("8.8.8.8", "secret-a");
  assert.equal(first, anonymousVisitorId("8.8.8.8", "secret-a"));
  assert.notEqual(first, anonymousVisitorId("8.8.8.8", "secret-b"));
  assert.equal(first.length, 20);
});

test("reduces coordinate precision and user-agent detail", () => {
  assert.equal(roundCoordinate(-23.55052), -23.55);
  assert.deepEqual(
    parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17 Mobile/15E148 Safari/604.1"),
    { browser: "Safari", os: "iOS", device: "Mobile" },
  );
});

test("compares administrative tokens", () => {
  assert.equal(tokensMatch("atlas-secret", "atlas-secret"), true);
  assert.equal(tokensMatch("atlas", "atlas-secret"), false);
  assert.equal(tokensMatch("", "atlas-secret"), false);
});
