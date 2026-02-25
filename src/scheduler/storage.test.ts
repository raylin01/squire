import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStorage } from './storage.js';
import type { ScheduledTask, TaskResult } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TaskStorage', () => {
  let storage: TaskStorage;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));
    dbPath = path.join(tempDir, 'test.db');
    storage = new TaskStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds and retrieves a task with payload and timezone', () => {
    const task = createTestTask('test-1', {
      timezone: 'America/New_York',
      payload: { objective: 'Check build', context: 'nightly run' },
    });

    storage.addTask(task);
    const retrieved = storage.getTask('test-1');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.kind).toBe('self');
    expect(retrieved?.payload.objective).toBe('Check build');
    expect(retrieved?.timezone).toBe('America/New_York');
  });

  it('returns due tasks only when pending', () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    storage.addTask(createTestTask('pending', { nextRunAt: past, status: 'pending' }));
    storage.addTask(createTestTask('running', { nextRunAt: past, status: 'running' }));
    storage.addTask(createTestTask('awaiting', { nextRunAt: past, status: 'awaiting_user' }));

    const due = storage.getDueTasks();
    expect(due.map(t => t.taskId)).toEqual(['pending']);
  });

  it('records run lifecycle and awaiting_user failure details', () => {
    storage.addTask(createTestTask('task-1'));

    const runId = storage.startRun('task-1');
    const result: TaskResult = {
      success: false,
      error: 'workspace missing',
      parsedSummary: 'Task could not run because workspace is unavailable.',
      suggestedFixes: ['Retry later', 'Recreate workspace mapping'],
      completedAt: new Date().toISOString(),
    };

    storage.updateAfterRun({
      taskId: 'task-1',
      runId,
      result,
      status: 'awaiting_user',
      awaitingDecisionReason: 'workspace missing',
    });

    const task = storage.getTask('task-1');
    expect(task?.status).toBe('awaiting_user');
    expect(task?.awaitingDecisionReason).toBe('workspace missing');
    expect(task?.result?.parsedSummary).toContain('workspace');

    const latestRun = storage.getLatestRun('task-1');
    expect(latestRun?.status).toBe('awaiting_user');
    expect(latestRun?.rawError).toBe('workspace missing');
  });

  it('supports retry/skip/pause/resume/disable transitions', () => {
    storage.addTask(createTestTask('task-1', {
      status: 'awaiting_user',
      nextRunAt: new Date(Date.now() - 300_000).toISOString(),
    }));

    expect(storage.pauseTask('task-1')).toBe(true);
    expect(storage.getTask('task-1')?.status).toBe('paused');

    expect(storage.resumeTask('task-1')).toBe(true);
    expect(storage.getTask('task-1')?.status).toBe('pending');

    storage.updateStatus('task-1', 'awaiting_user', 'needs decision');
    expect(storage.retryNow('task-1')).toBe(true);
    expect(storage.getTask('task-1')?.status).toBe('pending');

    storage.updateStatus('task-1', 'awaiting_user', 'needs decision');
    const next = new Date(Date.now() + 60_000).toISOString();
    expect(storage.skipRun('task-1', next)).toBe(true);
    expect(storage.getTask('task-1')?.nextRunAt).toBe(next);

    expect(storage.disableTask('task-1')).toBe(true);
    expect(storage.getTask('task-1')?.status).toBe('cancelled');
  });
});

function createTestTask(taskId: string, options: Partial<ScheduledTask> = {}): ScheduledTask {
  const defaults: ScheduledTask = {
    taskId,
    workspaceId: 'default-workspace',
    kind: 'self',
    description: `Task ${taskId}`,
    payload: { objective: `Task ${taskId}` },
    schedule: { type: 'interval', value: 60_000 },
    status: 'pending',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  return { ...defaults, ...options };
}
