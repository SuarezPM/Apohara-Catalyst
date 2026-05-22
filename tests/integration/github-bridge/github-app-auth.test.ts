import { test, expect } from "bun:test";
import { GitHubAppAuth } from "../../../packages/github-bridge/src/github-app-auth.js";

test("throws if APP_ID env unset", () => {
  expect(() => new GitHubAppAuth()).toThrow(/APOHARA_GITHUB_APP_ID/);
});

test("throws if PRIVATE_KEY_PATH unset", () => {
  expect(() => new GitHubAppAuth({ appId: "123" })).toThrow(/APOHARA_GITHUB_APP_PRIVATE_KEY_PATH/);
});

test("accepts privateKey injection (no env read)", () => {
  const auth = new GitHubAppAuth({ appId: "123", privateKey: "BEGIN PRIVATE KEY---" });
  expect(auth).toBeDefined();
});

test("clearCache resets internal cache", () => {
  const auth = new GitHubAppAuth({ appId: "123", privateKey: "x" });
  expect(() => auth.clearCache()).not.toThrow();
});