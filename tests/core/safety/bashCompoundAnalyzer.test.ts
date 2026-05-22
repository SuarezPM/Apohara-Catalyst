import { test, expect } from "bun:test";
import { splitCompound } from "../../../src/core/safety/bashCompoundAnalyzer";

test("splits on &&", () => {
  expect(splitCompound("git status && echo done")).toEqual(["git status", "echo done"]);
});

test("splits on ||", () => {
  expect(splitCompound("test -f foo || touch foo")).toEqual(["test -f foo", "touch foo"]);
});

test("splits on ;", () => {
  expect(splitCompound("cd src; ls")).toEqual(["cd src", "ls"]);
});

test("does NOT split inside double-quoted strings", () => {
  expect(splitCompound('echo "a && b" && echo c')).toEqual(['echo "a && b"', "echo c"]);
});

test("does NOT split inside single-quoted strings", () => {
  expect(splitCompound("echo 'a; b' ; echo c")).toEqual(["echo 'a; b'", "echo c"]);
});

test("returns single element for non-compound", () => {
  expect(splitCompound("ls -la")).toEqual(["ls -la"]);
});