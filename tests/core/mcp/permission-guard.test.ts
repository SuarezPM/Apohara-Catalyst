import { expect, test } from "bun:test";
import { PermissionGuard } from "../../../src/core/mcp/permissionGuard";

test("registerPermissionedTool makes tool visible when allowed", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Read", requiredPerm: "fs.read" });
  guard.grantPermission("fs.read");
  expect(guard.isToolVisible("Read")).toBe(true);
});

test("unregistered tool is invisible (deny-by-non-registration)", () => {
  const guard = new PermissionGuard();
  guard.grantPermission("fs.read");
  expect(guard.isToolVisible("UnregisteredTool")).toBe(false);
});

test("registered tool without permission is invisible", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Bash", requiredPerm: "cmd.exec" });
  // No grant
  expect(guard.isToolVisible("Bash")).toBe(false);
});

test("revokePermission flips visibility back to false", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Read", requiredPerm: "fs.read" });
  guard.grantPermission("fs.read");
  expect(guard.isToolVisible("Read")).toBe(true);
  guard.revokePermission("fs.read");
  expect(guard.isToolVisible("Read")).toBe(false);
});

test("visibleTools returns only the granted+registered intersection", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Read", requiredPerm: "fs.read" });
  guard.registerPermissionedTool({ tool: "Bash", requiredPerm: "cmd.exec" });
  guard.registerPermissionedTool({ tool: "Write", requiredPerm: "fs.write" });
  guard.grantPermission("fs.read");
  guard.grantPermission("fs.write");
  const visible = guard.visibleTools().sort();
  expect(visible).toEqual(["Read", "Write"]);
});

test("multiple tools may share the same required permission", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Read", requiredPerm: "fs.access" });
  guard.registerPermissionedTool({ tool: "Glob", requiredPerm: "fs.access" });
  guard.grantPermission("fs.access");
  expect(guard.isToolVisible("Read")).toBe(true);
  expect(guard.isToolVisible("Glob")).toBe(true);
});
