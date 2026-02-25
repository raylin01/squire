import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scheduler, createScheduler } from './scheduler.js';
import type { TaskResult } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));
    dbPath = path.join(tempDir, 'test.db');
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates scheduler via constructor and factory', () => {
    scheduler = new Scheduler({ dbPath, pollInterval: 5000 });
    expect(scheduler.isRunning()).toBe(false);

    const factory = createScheduler({ dbPath: path.join(tempDir, 'other.db') });
    expect(factory).toBeInstanceOf(Scheduler);
    factory.close();
  });

  it('schedules tasks with self payload and optional timezone', () => {
    scheduler = new Scheduler({ dbPath });
    const task = scheduler.schedule(
      'workspace-1',
      'Daily sync',
      { type: 'cron', value: '0 9 * * *' },
      {
        timezone: 'America/New_York',
        payload: { objective: 'Run daily sync', context: 'morning routine' },
      }
    );

    expect(task.kind).toBe('self');
    expect(task.payload.context).toBe('morning routine');
    expect(task.timezone).toBe('America/New_York');
  });

  it('runs due once task and marks as completed', async () => {
    const executor = vi.fn().mockResolvedValue({
      success: true,
      output: 'Done',
      completedAt: new Date().toISOString(),
    } as TaskResult);

    scheduler = new Scheduler({ dbPath, pollInterval: 30, onTaskDue: executor });
    const past = new Date(Date.now() - 1000).toISOString();
    const task = scheduler.schedule('workspace-1', 'Once task', { type: 'once', value: past });

    scheduler.start();
    await new Promise(resolve => setTimeout(resolve, 120));
    scheduler.stop();

    const updated = scheduler.getTask(task.taskId);
    expect(executor).toHaveBeenCalled();
    expect(updated?.status).toBe('completed');
  });

  it('reschedules repeating task back to pending', async () => {
    const executor = vi.fn().mockResolvedValue({
      success: true,
      completedAt: new Date().toISOString(),
    } as TaskResult);

    scheduler = new Scheduler({ dbPath, pollInterval: 30, onTaskDue: executor });
    const task = scheduler.schedule('workspace-1', 'Repeat task', { type: 'interval', value: 60_000 });

    const storage = (scheduler as unknown as { storage: { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } } }).storage;
    storage.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE task_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), task.taskId);

    scheduler.start();
    await new Promise(resolve => setTimeout(resolve, 140));
    scheduler.stop();

    const updated = scheduler.getTask(task.taskId);
    expect(updated?.status).toBe('pending');
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('moves failed task to awaiting_user with summary', async () => {
    const executor = vi.fn().mockResolvedValue({
      success: false,
      error: 'permission denied',
      completedAt: new Date().toISOString(),
    } as TaskResult);

    scheduler = new Scheduler({ dbPath, pollInterval: 30, onTaskDue: executor });
    const task = scheduler.schedule('workspace-1', 'Fail task', {
      type: 'once',
      value: new Date(Date.now() - 1000).toISOString(),
    });

    scheduler.start();
    await new Promise(resolve => setTimeout(resolve, 120));
    scheduler.stop();

    const updated = scheduler.getTask(task.taskId);
    expect(updated?.status).toBe('awaiting_user');
    expect(updated?.result?.parsedSummary).toContain('failed');
  });

  it('supports lifecycle action methods', () => {
    scheduler = new Scheduler({ dbPath });
    const task = scheduler.schedule('workspace-1', 'Action task', { type: 'interval', value: 60_000 });

    expect(scheduler.pause(task.taskId)).toBe(true);
    expect(scheduler.getTask(task.taskId)?.status).toBe('paused');

    expect(scheduler.resume(task.taskId)).toBe(true);
    expect(scheduler.getTask(task.taskId)?.status).toBe('pending');

    scheduler.getTask(task.taskId)!.status = 'awaiting_user';
    const storage = (scheduler as unknown as { storage: { updateStatus: (id: string, status: any, reason?: string) => void } }).storage;
    storage.updateStatus(task.taskId, 'awaiting_user', 'needs action');

    expect(scheduler.retryNow(task.taskId, { autoFix: true })).toBe(true);
    expect(scheduler.getTask(task.taskId)?.payload.autoFixRequested).toBe(true);

    storage.updateStatus(task.taskId, 'awaiting_user', 'needs action');
    expect(scheduler.skipCurrentRun(task.taskId)).toBe(true);

    expect(scheduler.disable(task.taskId)).toBe(true);
    expect(scheduler.getTask(task.taskId)?.status).toBe('cancelled');
  });
});
