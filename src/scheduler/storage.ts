/**
 * Task Storage
 *
 * SQLite-based persistence for scheduled tasks.
 */

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type {
  ScheduledTask,
  ScheduledTaskPayload,
  ScheduledTaskRun,
  TaskResult,
  TaskSchedule,
  TaskStatus,
  TaskRunDecision,
} from '../types.js';

const SCHEMA = `
-- Scheduled tasks
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  task_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'self',
  description TEXT NOT NULL,
  payload_json TEXT,
  timezone TEXT,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  awaiting_decision_reason TEXT,
  last_decision_at TEXT,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  result_output TEXT,
  result_error TEXT,
  result_parsed_summary TEXT,
  result_suggested_fixes TEXT,
  result_success INTEGER,
  result_completed_at TEXT,
  run_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON scheduled_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON scheduled_tasks(workspace_id);

-- Legacy history table (kept for backwards compatibility)
CREATE TABLE IF NOT EXISTS task_history (
  history_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  success INTEGER,
  output TEXT,
  error TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_history_started ON task_history(started_at);

-- Run ledger for decisioning and retry workflows
CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  output_excerpt TEXT,
  raw_error TEXT,
  parsed_summary TEXT,
  decision TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON scheduled_task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON scheduled_task_runs(started_at);
`;

interface TaskRow {
  task_id: string;
  workspace_id: string;
  kind: string;
  description: string;
  payload_json: string | null;
  timezone: string | null;
  schedule_type: string;
  schedule_value: string;
  status: string;
  awaiting_decision_reason: string | null;
  last_decision_at: string | null;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  result_output: string | null;
  result_error: string | null;
  result_parsed_summary: string | null;
  result_suggested_fixes: string | null;
  result_success: number | null;
  result_completed_at: string | null;
  run_count: number;
}

interface TaskRunRow {
  run_id: string;
  task_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  output_excerpt: string | null;
  raw_error: string | null;
  parsed_summary: string | null;
  decision: string | null;
}

export class TaskStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.ensureColumns();
    this.migrateLegacyRows();
  }

  private ensureColumns(): void {
    const columnRows = this.db.prepare('PRAGMA table_info(scheduled_tasks)').all() as Array<{ name: string }>;
    const existing = new Set(columnRows.map(c => c.name));

    const requiredColumns: Array<{ name: string; sql: string }> = [
      { name: 'kind', sql: "ALTER TABLE scheduled_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'self'" },
      { name: 'payload_json', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN payload_json TEXT' },
      { name: 'timezone', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT' },
      { name: 'awaiting_decision_reason', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN awaiting_decision_reason TEXT' },
      { name: 'last_decision_at', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN last_decision_at TEXT' },
      { name: 'result_parsed_summary', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN result_parsed_summary TEXT' },
      { name: 'result_suggested_fixes', sql: 'ALTER TABLE scheduled_tasks ADD COLUMN result_suggested_fixes TEXT' },
    ];

    for (const column of requiredColumns) {
      if (!existing.has(column.name)) {
        this.db.exec(column.sql);
      }
    }
  }

  private migrateLegacyRows(): void {
    // Backfill payload for legacy rows.
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET payload_json = json_object('objective', description)
      WHERE payload_json IS NULL OR payload_json = ''
    `).run();

    // Legacy repeating tasks were marked completed and never scheduled again.
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'pending'
      WHERE status = 'completed' AND schedule_type != 'once'
    `).run();

    // Scheduler restart recovery.
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'pending'
      WHERE status = 'running'
    `).run();
  }

  /**
   * Add a new task
   */
  addTask(task: ScheduledTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_tasks (
        task_id, workspace_id, kind, description, payload_json, timezone,
        schedule_type, schedule_value, status, awaiting_decision_reason, last_decision_at,
        last_run_at, next_run_at, created_at, run_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      task.taskId,
      task.workspaceId,
      task.kind,
      task.description,
      JSON.stringify(task.payload),
      task.timezone || null,
      task.schedule.type,
      String(task.schedule.value),
      task.status,
      task.awaitingDecisionReason || null,
      task.lastDecisionAt || null,
      task.lastRunAt || null,
      task.nextRunAt,
      task.createdAt
    );
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE task_id = ?').get(taskId) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    const rows = this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY next_run_at').all() as TaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Get tasks by workspace
   */
  getTasksByWorkspace(workspaceId: string): ScheduledTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM scheduled_tasks WHERE workspace_id = ? ORDER BY next_run_at'
    ).all(workspaceId) as TaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Get due tasks (ready to run)
   */
  getDueTasks(now: Date = new Date()): ScheduledTask[] {
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status = 'pending'
      AND next_run_at <= ?
      ORDER BY next_run_at
    `).all(now.toISOString()) as TaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Atomically claim due pending tasks so overlapping polls cannot run the same row twice.
   */
  claimDueTasks(now: Date = new Date()): ScheduledTask[] {
    return this.db.transaction(() => {
      const due = this.getDueTasks(now);
      const claimed: ScheduledTask[] = [];
      const claim = this.db.prepare(`
        UPDATE scheduled_tasks
        SET status = 'running'
        WHERE task_id = ? AND status = 'pending'
      `);
      for (const task of due) {
        const result = claim.run(task.taskId);
        if (result.changes === 1) {
          claimed.push({ ...task, status: 'running' });
        }
      }
      return claimed;
    })();
  }

  /**
   * Update task status
   */
  updateStatus(taskId: string, status: TaskStatus, reason?: string): void {
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = ?, awaiting_decision_reason = ?, last_decision_at = ?
      WHERE task_id = ?
    `).run(
      status,
      reason || null,
      status === 'awaiting_user' || status === 'paused' || status === 'cancelled' ? new Date().toISOString() : null,
      taskId
    );
  }

  /**
   * Update task payload
   */
  updatePayload(taskId: string, payload: ScheduledTaskPayload): void {
    this.db.prepare('UPDATE scheduled_tasks SET payload_json = ? WHERE task_id = ?').run(JSON.stringify(payload), taskId);
  }

  /**
   * Start a run record
   */
  startRun(taskId: string, startedAt: string = new Date().toISOString()): string {
    const runId = uuid();
    this.db.prepare(`
      INSERT INTO scheduled_task_runs (
        run_id, task_id, started_at, status
      ) VALUES (?, ?, ?, 'running')
    `).run(runId, taskId, startedAt);
    return runId;
  }

  /**
   * Update task after execution
   */
  updateAfterRun(options: {
    taskId: string;
    runId: string;
    result: TaskResult;
    status: TaskStatus;
    nextRunAt?: string;
    awaitingDecisionReason?: string;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks SET
        status = ?,
        awaiting_decision_reason = ?,
        last_decision_at = ?,
        last_run_at = ?,
        result_output = ?,
        result_error = ?,
        result_parsed_summary = ?,
        result_suggested_fixes = ?,
        result_success = ?,
        result_completed_at = ?,
        next_run_at = COALESCE(?, next_run_at),
        run_count = run_count + 1
      WHERE task_id = ?
    `);

    stmt.run(
      options.status,
      options.awaitingDecisionReason || null,
      options.status === 'awaiting_user' || options.status === 'paused' || options.status === 'cancelled'
        ? options.result.completedAt
        : null,
      options.result.completedAt,
      options.result.output || null,
      options.result.error || null,
      options.result.parsedSummary || null,
      options.result.suggestedFixes ? JSON.stringify(options.result.suggestedFixes) : null,
      options.result.success ? 1 : 0,
      options.result.completedAt,
      options.nextRunAt || null,
      options.taskId
    );

    this.completeRun(options.runId, {
      status: options.status,
      completedAt: options.result.completedAt,
      outputExcerpt: options.result.output?.slice(0, 500),
      rawError: options.result.error,
      parsedSummary: options.result.parsedSummary,
    });

    // Keep legacy table in sync.
    this.addLegacyHistory(options.taskId, options.result);
  }

  /**
   * Mark run decision (e.g. retry, skip, disable).
   */
  recordLatestRunDecision(taskId: string, decision: TaskRunDecision): void {
    this.db.prepare(`
      UPDATE scheduled_task_runs
      SET decision = ?
      WHERE run_id = (
        SELECT run_id FROM scheduled_task_runs
        WHERE task_id = ?
        ORDER BY started_at DESC
        LIMIT 1
      )
    `).run(decision, taskId);
  }

  /**
   * Complete a run entry
   */
  completeRun(runId: string, options: {
    status: TaskStatus;
    completedAt: string;
    outputExcerpt?: string;
    rawError?: string;
    parsedSummary?: string;
  }): void {
    this.db.prepare(`
      UPDATE scheduled_task_runs
      SET completed_at = ?, status = ?, output_excerpt = ?, raw_error = ?, parsed_summary = ?
      WHERE run_id = ?
    `).run(
      options.completedAt,
      options.status,
      options.outputExcerpt || null,
      options.rawError || null,
      options.parsedSummary || null,
      runId
    );
  }

  /**
   * Retry immediately.
   */
  retryNow(taskId: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'pending',
          awaiting_decision_reason = NULL,
          last_decision_at = ?,
          next_run_at = ?
      WHERE task_id = ?
      AND status IN ('awaiting_user', 'failed', 'paused')
    `).run(new Date().toISOString(), new Date().toISOString(), taskId);

    return result.changes > 0;
  }

  /**
   * Skip current failed run and schedule the next execution.
   */
  skipRun(taskId: string, nextRunAt: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'pending',
          awaiting_decision_reason = NULL,
          last_decision_at = ?,
          next_run_at = ?
      WHERE task_id = ?
      AND status IN ('awaiting_user', 'failed')
    `).run(new Date().toISOString(), nextRunAt, taskId);

    return result.changes > 0;
  }

  pauseTask(taskId: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'paused',
          last_decision_at = ?
      WHERE task_id = ?
      AND status != 'cancelled'
    `).run(new Date().toISOString(), taskId);
    return result.changes > 0;
  }

  resumeTask(taskId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'pending',
          awaiting_decision_reason = NULL,
          last_decision_at = ?,
          next_run_at = CASE
            WHEN next_run_at < ? THEN ?
            ELSE next_run_at
          END
      WHERE task_id = ?
      AND status IN ('paused', 'awaiting_user', 'failed')
    `).run(now, now, now, taskId);
    return result.changes > 0;
  }

  disableTask(taskId: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_tasks
      SET status = 'cancelled',
          last_decision_at = ?
      WHERE task_id = ?
    `).run(new Date().toISOString(), taskId);
    return result.changes > 0;
  }

  /**
   * Get latest run for a task.
   */
  getLatestRun(taskId: string): ScheduledTaskRun | null {
    const row = this.db.prepare(`
      SELECT * FROM scheduled_task_runs
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(taskId) as TaskRunRow | undefined;

    return row ? this.rowToRun(row) : null;
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    this.db.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ?').run(taskId);
    const result = this.db.prepare('DELETE FROM scheduled_tasks WHERE task_id = ?').run(taskId);
    return result.changes > 0;
  }

  private addLegacyHistory(taskId: string, result: TaskResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_history (history_id, task_id, started_at, completed_at, success, output, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      uuid(),
      taskId,
      result.completedAt,
      result.completedAt,
      result.success ? 1 : 0,
      result.output || null,
      result.error || null
    );
  }

  /**
   * Convert database row to ScheduledTask
   */
  private rowToTask(row: TaskRow): ScheduledTask {
    const schedule: TaskSchedule = {
      type: row.schedule_type as TaskSchedule['type'],
      value: row.schedule_type === 'interval' ? parseInt(row.schedule_value, 10) : row.schedule_value,
    };

    let payload: ScheduledTaskPayload;
    try {
      payload = row.payload_json
        ? JSON.parse(row.payload_json) as ScheduledTaskPayload
        : { objective: row.description };
    } catch {
      payload = { objective: row.description };
    }

    const task: ScheduledTask = {
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      kind: 'self',
      description: row.description,
      payload,
      timezone: row.timezone || undefined,
      schedule,
      status: row.status as TaskStatus,
      awaitingDecisionReason: row.awaiting_decision_reason || undefined,
      lastDecisionAt: row.last_decision_at || undefined,
      lastRunAt: row.last_run_at || undefined,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      runCount: row.run_count,
    };

    if (row.result_success !== null) {
      let suggestedFixes: string[] | undefined;
      if (row.result_suggested_fixes) {
        try {
          suggestedFixes = JSON.parse(row.result_suggested_fixes) as string[];
        } catch {
          suggestedFixes = undefined;
        }
      }

      task.result = {
        success: row.result_success === 1,
        output: row.result_output || undefined,
        error: row.result_error || undefined,
        parsedSummary: row.result_parsed_summary || undefined,
        suggestedFixes,
        completedAt: row.result_completed_at || new Date().toISOString(),
      };
    }

    return task;
  }

  private rowToRun(row: TaskRunRow): ScheduledTaskRun {
    return {
      runId: row.run_id,
      taskId: row.task_id,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      status: row.status as TaskStatus,
      outputExcerpt: row.output_excerpt || undefined,
      rawError: row.raw_error || undefined,
      parsedSummary: row.parsed_summary || undefined,
      decision: row.decision as TaskRunDecision | undefined,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
