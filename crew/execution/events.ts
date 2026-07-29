import * as fs from "node:fs";
import * as path from "node:path";

export type SchedulerEventName =
  | "scheduler.authorized" | "scheduler.paused" | "scheduler.reconcile"
  | "task.dispatch" | "task.protocol_incomplete" | "task.worker_crash"
  | "task.cancelled" | "task.review_pending" | "task.review_claimed"
  | "task.review_completed" | "task.review_failed" | "scheduler.idle";

export interface SchedulerEvent {
  version: 1;
  name: SchedulerEventName;
  at: string;
  planRunId: string;
  controllerId: string;
  reasons: string[];
  taskId?: string;
  attemptId?: string;
  fields?: Record<string, unknown>;
}

export function canonicalReasons(reasons: Iterable<string>): string[] {
  return Array.from(new Set(reasons)).sort((left, right) => left.localeCompare(right));
}

export function appendSchedulerEvent(cwd: string, event: SchedulerEvent): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "scheduler-events.jsonl");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({
    ...event,
    reasons: canonicalReasons(event.reasons),
  })}\n`);
}
