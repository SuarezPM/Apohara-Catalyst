import { atom } from "jotai/vanilla";

export type VerificationStep =
  | "lock_acquired"
  | "agent_acted"
  | "judge_scored"
  | "critic_scored"
  | "ledger_entry_hashed";

export const ALL_STEPS: readonly VerificationStep[] = [
  "lock_acquired", "agent_acted", "judge_scored", "critic_scored", "ledger_entry_hashed",
] as const;

export type StepStatus = "pending" | "in_progress" | "done" | "failed";

export interface VerificationState {
  steps: Record<VerificationStep, StepStatus>;
  taskId?: string;
}

const INITIAL: VerificationState = {
  steps: {
    lock_acquired: "pending",
    agent_acted: "pending",
    judge_scored: "pending",
    critic_scored: "pending",
    ledger_entry_hashed: "pending",
  },
};

export const verificationAtom = atom<VerificationState>(INITIAL);

export const setStepStatusAtom = atom(null, (get, set, args: { step: VerificationStep; status: StepStatus }) => {
  const current = get(verificationAtom);
  set(verificationAtom, {
    ...current,
    steps: { ...current.steps, [args.step]: args.status },
  });
});

export const resetVerificationAtom = atom(null, (_get, set, taskId?: string) => {
  set(verificationAtom, { ...INITIAL, taskId });
});

export const verificationProgressAtom = atom((get) => {
  const v = get(verificationAtom);
  const done = ALL_STEPS.filter((s) => v.steps[s] === "done").length;
  return { done, total: ALL_STEPS.length, percent: Math.round((done / ALL_STEPS.length) * 100) };
});