/**
 * Static DI bucket per spec §4.5 (nimbalyst #1.4 inspiration).
 *
 * One module-level object holds all the "ports" the providers need from the
 * rest of Apohara (hook endpoint accessor, indexer socket path, ledger path,
 * etc.). Bootstrap calls setApoharaDeps once at startup; everything else
 * reads via getApoharaDeps. Avoids circular imports between providers and
 * indexer/ledger/capability modules.
 */

export interface HookEndpoint {
  port: number;
  token: string;
}

export interface ApoharaDeps {
  hookEndpoint: () => HookEndpoint;
  indexerSocketPath: string;
  ledgerPath: string;
  capabilityStatsPath: string;
}

let deps: ApoharaDeps | null = null;

export function setApoharaDeps(next: ApoharaDeps): void {
  deps = next;
}

export function getApoharaDeps(): ApoharaDeps {
  if (!deps) {
    throw new Error("ApoharaDeps not initialized — call setApoharaDeps(...) at startup");
  }
  return deps;
}

export function resetApoharaDeps(): void {
  deps = null;
}