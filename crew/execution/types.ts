export type ExecutionMode = "idle" | "wave" | "continuous" | "targeted" | "paused";
export type ReviewState = "pending" | "claiming" | "ship" | "needs_work" | "major_rethink" | "failed";
export type ReviewOutcome = "SHIP" | "NEEDS_WORK" | "MAJOR_RETHINK";
export type CancellationKind = "user_stop" | "orchestrator_shutdown";
export type AttemptState = "starting" | "running" | "closed";

export interface WaveTargetEntry {
  authorized: boolean;
  retryEligible: boolean;
  terminal: boolean;
  unavailableReason?: string;
}

export interface CancellationIntent {
  requestedBy: string;
  kind: CancellationKind;
  attemptIds: string[];
  requestedAt: string;
}

export interface SchedulerRecord {
  version: 1;
  runId: string;
  controllerId: string;
  leaseEpoch: number;
  mode: ExecutionMode;
  waveSnapshotTaskIds: string[];
  waveTargetState: Record<string, WaveTargetEntry>;
  desiredConcurrencyOverride: number | null;
  activeAttemptIds: string[];
  cancellationIntent: CancellationIntent | null;
  interruptedAt?: string;
}

export interface ControllerLease {
  version: 1;
  controllerId: string;
  leaseEpoch: number;
  pid: number;
  planRunId: string;
  normalizedRepoPath: string;
  acquiredAt: string;
}

export interface AttemptCancellation {
  kind: CancellationKind;
  requestedBy: string;
  requestedAt: string;
}

export interface AttemptRecord {
  version: 1;
  attemptId: string;
  runId: string;
  taskId: string;
  controllerId: string;
  leaseEpoch: number;
  workerName: string;
  pid: number | null;
  startedAt: string;
  closedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  state: AttemptState;
  attemptCharged: boolean;
  rollbackApplied: boolean;
  cancellation: AttemptCancellation | null;
}

export interface LegacyReviewState {
  version: 1;
  state: ReviewState;
  claimToken?: string;
  claimantControllerId?: string;
  claimedAt?: string;
  completedAt?: string;
  reviewCount: number;
  outcome?: ReviewOutcome;
  failureCode?: string;
  attemptId: string;
}
