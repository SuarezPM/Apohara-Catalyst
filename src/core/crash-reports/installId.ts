// src/core/crash-reports/installId.ts
//
// Crash reports use the same anonymous install identifier as telemetry.
// The crash-reports module re-exports it for locality (callers in this folder
// import from "./installId" instead of reaching across to ../telemetry).
//
// If crash-reports ever needs a different identifier format, change this
// module to wrap getOrCreateInstallId with format conversion instead of
// re-exporting it raw.

export { getOrCreateInstallId } from "../telemetry/install-id";
