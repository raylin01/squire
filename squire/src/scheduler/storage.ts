/**
 * Task Storage
 *
 * SQLite-based persistence for scheduled tasks.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { ScheduledTask, TaskResult, TaskSchedule } from '../types.js';

const SCHEMA = `
-- Scheduled tasks
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  task_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  description TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  result_output TEXT,
  result_error TEXT,
  result_success INTEGER,
  result_completed_at TEXT,
  run_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON scheduled_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON scheduled_tasks(workspace_id);

-- Task execution history
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
`;

export interface TaskRow {
  task_id: string;
  workspace_id: string;
  description: string;
  schedule_type: string;
  schedule_value: string;
  status: string;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  result_output: string | null;
  result_error: string | null;
  result_success: number | null;
  result_completed_at: string | null;
  run_count: number;
}

export class TaskStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Add a new task
   */
  addTask(task: ScheduledTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_tasks (
        task_id, workspace_id, description,
        schedule_type, schedule_value, status,
        last_run_at, next_run_at, created_at,
        run_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      task.taskId,
      task.workspaceId,
      task.description,
      task.schedule.type,
      String(task.schedule.value),
      task.status,
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
    return rows.map(this.rowToTask);
  }

  /**
   * Get tasks by workspace
   */
  getTasksByWorkspace(workspaceId: string): ScheduledTask[] {
    const rows = this.db.prepare('SELECT * FROM scheduled_tasks WHERE workspace_id = ? ORDER BY next_run_at').all(workspaceId) as TaskRow[];
    return rows.map(this.rowToTask);
  }

  /**
   * Get due tasks (ready to run)
   */
  getDueTasks(): ScheduledTask[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status IN ('pending', 'running')
      AND next_run_at <= ?
      ORDER BY next_run_at
    `).all(now) as TaskRow[];
    return rows.map(this.rowToTask);
  }

  /**
   * Update task status
   */
  updateStatus(taskId: string, status: ScheduledTask['status']): void {
    this.db.prepare('UPDATE scheduled_tasks SET status = ? WHERE task_id = ?').run(status, taskId);
  }

  /**
   * Update task after execution
   */
  updateAfterRun(taskId: string, result: TaskResult, nextRunAt?: string): void {
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks SET
        status = ?,
        last_run_at = ?,
        result_output = ?,
        result_error = ?,
        result_success = ?,
        result_completed_at = ?,
        next_run_at = COALESCE(?, next_run_at),
        run_count = run_count + 1
      WHERE task_id = ?
    `);

    const newStatus = result.success ? 'completed' : 'failed';
    stmt.run(
      newStatus,
      result.completedAt,
      result.output || null,
      result.error || null,
      result.success ? 1 : 0,
      result.completedAt,
      nextRunAt || null,
      taskId
    );

    // Add to history
    this.addHistory(taskId, result);
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    const result = this.db.prepare('DELETE FROM scheduled_tasks WHERE task_id = ?').run(taskId);
    return result.changes > 0;
  }

  /**
   * Add execution history
   */
  private addHistory(taskId: string, result: TaskResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_history (history_id, task_id, started_at, completed_at, success, output, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      uuid(),
      taskId,
      result.completedAt, // Simplified - would need actual start time
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
      value: row.schedule_type === 'interval' ? parseInt(row.schedule_value, 10) : row.schedule_value
    };

    const task: ScheduledTask = {
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      description: row.description,
      schedule,
      status: row.status as ScheduledTask['status'],
      lastRunAt: row.last_run_at || undefined,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      runCount: row.run_count,
    };

    if (row.result_success !== null) {
      task.result = {
        success: row.result_success === 1,
        output: row.result_output || undefined,
        error: row.result_error || undefined,
        completedAt: row.result_completed_at || new Date().toISOString(),
      };
    }

    return task;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
