import { expect, test } from "bun:test";
import {
  DualStatusAC,
  type ACStatus,
} from "../../../src/core/verification/dualStatusAC";

test("AC dev-status and admin-status both start as 'pending'", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  expect(ac.devStatus).toBe("pending");
  expect(ac.adminStatus).toBe("pending");
});

test("agent sets devStatus, admin reviews and sets adminStatus", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  ac.setDevStatus("passed");
  expect(ac.devStatus).toBe("passed");
  expect(ac.isFullyApproved()).toBe(false); // admin hasn't acted
  ac.setAdminStatus("approved");
  expect(ac.isFullyApproved()).toBe(true);
});

test("isFullyApproved requires BOTH passed and approved", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  ac.setDevStatus("passed");
  ac.setAdminStatus("rejected");
  expect(ac.isFullyApproved()).toBe(false);
});

test("isRejected reflects failure in either lane", () => {
  const onlyDevFailed = new DualStatusAC({ id: "ac-2", description: "x" });
  onlyDevFailed.setDevStatus("failed");
  expect(onlyDevFailed.isRejected()).toBe(true);

  const onlyAdminRejected = new DualStatusAC({ id: "ac-3", description: "y" });
  onlyAdminRejected.setDevStatus("passed");
  onlyAdminRejected.setAdminStatus("rejected");
  expect(onlyAdminRejected.isRejected()).toBe(true);

  const pending = new DualStatusAC({ id: "ac-4", description: "z" });
  expect(pending.isRejected()).toBe(false);
});

test("id and description are exposed as readonly metadata", () => {
  const ac = new DualStatusAC({ id: "ac-5", description: "auth wiring" });
  expect(ac.id).toBe("ac-5");
  expect(ac.description).toBe("auth wiring");
});

test("ACStatus type union admits the documented states", () => {
  // pure compile-time + value check: assignment proves the union shape.
  const states: ACStatus[] = [
    "pending",
    "passed",
    "failed",
    "approved",
    "rejected",
  ];
  expect(states.length).toBe(5);
});
