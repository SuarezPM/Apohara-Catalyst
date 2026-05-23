import { expect, test } from "bun:test";
import {
  PermissionGrid,
  type PermissionRow,
} from "../../../src/core/safety/permissionGrid";

test("grid stores per-(scope, resource) permission state", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  grid.set("once", "cmd.exec.git", "deny");
  expect(grid.get("session", "fs.read.*")).toBe("allow");
  expect(grid.get("once", "cmd.exec.git")).toBe("deny");
});

test("get returns 'unset' for unconfigured cell", () => {
  const grid = new PermissionGrid();
  expect(grid.get("always", "fs.write.*")).toBe("unset");
});

test("set with 'unset' deletes a previously configured cell", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  expect(grid.get("session", "fs.read.*")).toBe("allow");
  grid.set("session", "fs.read.*", "unset");
  expect(grid.get("session", "fs.read.*")).toBe("unset");
});

test("exportRows returns all configured cells as flat array", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  grid.set("once", "cmd.exec.*", "deny");
  const rows = grid.exportRows();
  expect(rows).toHaveLength(2);
  expect(rows).toContainEqual({
    scope: "session",
    resource: "fs.read.*",
    state: "allow",
  });
  expect(rows).toContainEqual({
    scope: "once",
    resource: "cmd.exec.*",
    state: "deny",
  });
});

test("exportRows skips unset cells", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  grid.set("once", "fs.write.*", "unset"); // explicitly unset
  expect(grid.exportRows()).toHaveLength(1);
});

test("same resource across different scopes is independent", () => {
  const grid = new PermissionGrid();
  grid.set("once", "cmd.exec.git", "allow");
  grid.set("session", "cmd.exec.git", "deny");
  grid.set("always", "cmd.exec.git", "allow");
  expect(grid.get("once", "cmd.exec.git")).toBe("allow");
  expect(grid.get("session", "cmd.exec.git")).toBe("deny");
  expect(grid.get("always", "cmd.exec.git")).toBe("allow");
  expect(grid.exportRows()).toHaveLength(3);
});

test("PermissionRow shape matches exported value", () => {
  const grid = new PermissionGrid();
  grid.set("always", "net.fetch.*", "allow");
  const rows: PermissionRow[] = grid.exportRows();
  expect(rows[0].scope).toBe("always");
  expect(rows[0].resource).toBe("net.fetch.*");
  expect(rows[0].state).toBe("allow");
});
