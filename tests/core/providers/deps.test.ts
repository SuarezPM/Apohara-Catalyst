import { test, expect, beforeEach } from "bun:test";
import { type ApoharaDeps, setApoharaDeps, getApoharaDeps, resetApoharaDeps } from "../../../src/core/providers/deps";

beforeEach(() => resetApoharaDeps());

test("getApoharaDeps throws before setApoharaDeps is called", () => {
  expect(() => getApoharaDeps()).toThrow();
});

test("setApoharaDeps + getApoharaDeps roundtrip", () => {
  const stub: ApoharaDeps = {
    hookEndpoint: () => ({ port: 8901, token: "t" }),
    indexerSocketPath: "/tmp/sock",
    ledgerPath: "/tmp/ledger.jsonl",
    capabilityStatsPath: "/tmp/stats.json",
  };
  setApoharaDeps(stub);
  expect(getApoharaDeps().indexerSocketPath).toBe("/tmp/sock");
});

test("setApoharaDeps allows partial override", () => {
  const initial: ApoharaDeps = {
    hookEndpoint: () => ({ port: 1, token: "a" }),
    indexerSocketPath: "/a",
    ledgerPath: "/a",
    capabilityStatsPath: "/a",
  };
  setApoharaDeps(initial);
  setApoharaDeps({ ...getApoharaDeps(), indexerSocketPath: "/b" });
  expect(getApoharaDeps().indexerSocketPath).toBe("/b");
  expect(getApoharaDeps().ledgerPath).toBe("/a");
});