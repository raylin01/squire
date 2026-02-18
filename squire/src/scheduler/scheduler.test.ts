import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scheduler, createScheduler } from './scheduler.js';
import type { ScheduledTask, TaskResult } from '../types.js';
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

  describe('constructor', () => {
    it('should create scheduler with default poll interval', () => {
      scheduler = new Scheduler({ dbPath });
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should create scheduler with custom poll interval', () => {
      scheduler = new Scheduler({ dbPath, pollInterval: 5000 });
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should create scheduler using factory function', () => {
      scheduler = createScheduler({ dbPath });
      expect(scheduler).toBeInstanceOf(Scheduler);
    });
  });

  describe('schedule', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath });
    });

    it('should schedule a new interval task', () => {
      const task = scheduler.schedule(
        'workspace-1',
        'Test task',
        { type: 'interval', value: 60000 }
      );

      expect(task.taskId).toBeDefined();
      expect(task.workspaceId).toBe('workspace-1');
      expect(task.description).toBe('Test task');
      expect(task.status).toBe('pending');
      expect(task.nextRunAt).toBeDefined();
    });

    it('should schedule a one-time task', () => {
      const futureDate = new Date(Date.now() + 3600000);
      const task = scheduler.schedule(
        'workspace-1',
        'One-time task',
        { type: 'once', value: futureDate.toISOString() }
      );

      expect(task.schedule.type).toBe('once');
    });

    it('should schedule a cron task', () => {
      const task = scheduler.schedule(
        'workspace-1',
        'Daily task',
        { type: 'cron', value: '0 9 * * *' }
      );

      expect(task.schedule.type).toBe('cron');
      expect(task.schedule.value).toBe('0 9 * * *');
    });

    it('should persist scheduled task', () => {
      scheduler.schedule('workspace-1', 'Persisted task', { type: 'interval', value: 60000 });

      const tasks = scheduler.getTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toBe('Persisted task');
    });
  });

  describe('getTask', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath });
    });

    it('should retrieve scheduled task by ID', () => {
      const created = scheduler.schedule('workspace-1', 'Test', { type: 'interval', value: 60000 });
      const retrieved = scheduler.getTask(created.taskId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.taskId).toBe(created.taskId);
    });

    it('should return null for non-existent task', () => {
      const result = scheduler.getTask('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getTasks', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath });
    });

    it('should return all scheduled tasks', () => {
      scheduler.schedule('w1', 'Task 1', { type: 'interval', value: 60000 });
      scheduler.schedule('w2', 'Task 2', { type: 'interval', value: 120000 });

      const tasks = scheduler.getTasks();
      expect(tasks.length).toBe(2);
    });
  });

  describe('getTasksByWorkspace', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath });
    });

    it('should filter tasks by workspace', () => {
      scheduler.schedule('workspace-a', 'Task A1', { type: 'interval', value: 60000 });
      scheduler.schedule('workspace-b', 'Task B1', { type: 'interval', value: 60000 });
      scheduler.schedule('workspace-a', 'Task A2', { type: 'interval', value: 60000 });

      const tasks = scheduler.getTasksByWorkspace('workspace-a');
      expect(tasks.length).toBe(2);
      expect(tasks.every(t => t.workspaceId === 'workspace-a')).toBe(true);
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath });
    });

    it('should cancel a scheduled task', () => {
      const task = scheduler.schedule('workspace-1', 'To cancel', { type: 'interval', value: 60000 });

      const cancelled = scheduler.cancel(task.taskId);
      expect(cancelled).toBe(true);
      expect(scheduler.getTask(task.taskId)).toBeNull();
    });

    it('should return false for non-existent task', () => {
      const cancelled = scheduler.cancel('non-existent');
      expect(cancelled).toBe(false);
    });
  });

  describe('start/stop', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath, pollInterval: 100 });
    });

    it('should start the scheduler', () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should stop the scheduler', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      scheduler.start();
      scheduler.start(); // Should be a no-op
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should not stop if not running', () => {
      scheduler.stop(); // Should be a no-op
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('task execution', () => {
    it('should execute due tasks', async () => {
      const executor = vi.fn().mockResolvedValue({
        success: true,
        output: 'Done',
        completedAt: new Date().toISOString(),
      } as TaskResult);

      scheduler = new Scheduler({
        dbPath,
        pollInterval: 50,
        onTaskDue: executor,
      });

      // Schedule a task in the past so it's due immediately
      const past = new Date(Date.now() - 1000).toISOString();
      const task = scheduler.schedule('workspace-1', 'Due task', { type: 'once', value: past });

      scheduler.start();

      // Wait for poll
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(executor).toHaveBeenCalled();
      expect(executor).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.taskId,
      }));

      scheduler.stop();
    });

    it('should handle executor errors', async () => {
      const executor = vi.fn().mockRejectedValue(new Error('Executor failed'));

      scheduler = new Scheduler({
        dbPath,
        pollInterval: 50,
        onTaskDue: executor,
      });

      const past = new Date(Date.now() - 1000).toISOString();
      scheduler.schedule('workspace-1', 'Failing task', { type: 'once', value: past });

      scheduler.start();

      await new Promise(resolve => setTimeout(resolve, 100));

      const tasks = scheduler.getTasks();
      expect(tasks[0].status).toBe('failed');
      expect(tasks[0].result?.error).toBe('Executor failed');

      scheduler.stop();
    });

    it('should reschedule interval tasks after execution', async () => {
      const executor = vi.fn().mockResolvedValue({
        success: true,
        completedAt: new Date().toISOString(),
      } as TaskResult);

      scheduler = new Scheduler({
        dbPath,
        pollInterval: 50,
        onTaskDue: executor,
      });

      // Schedule an interval task
      const task = scheduler.schedule('workspace-1', 'Repeating task', { type: 'interval', value: 60000 });

      // Manually set nextRunAt to the past so it's due immediately
      // (interval tasks start with nextRunAt in the future)
      const past = new Date(Date.now() - 1000).toISOString();
      const storage = (scheduler as unknown as { storage: { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } } }).storage;
      storage.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE task_id = ?').run(past, task.taskId);

      scheduler.start();

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 150));

      const updated = scheduler.getTask(task.taskId);
      expect(updated?.status).toBe('completed');
      // Next run should be in the future (rescheduled)
      expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);

      scheduler.stop();
    });
  });

  describe('setExecutor', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ dbPath, pollInterval: 50 });
    });

    it('should set executor after creation', async () => {
      const executor = vi.fn().mockResolvedValue({
        success: true,
        completedAt: new Date().toISOString(),
      } as TaskResult);

      scheduler.setExecutor(executor);

      const past = new Date(Date.now() - 1000).toISOString();
      scheduler.schedule('workspace-1', 'Task', { type: 'once', value: past });

      scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(executor).toHaveBeenCalled();

      scheduler.stop();
    });
  });
});
