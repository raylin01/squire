import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStorage } from './storage.js';
import type { ScheduledTask, TaskSchedule, TaskResult } from '../types.js';
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

  describe('addTask', () => {
    it('should add a new task', () => {
      const schedule: TaskSchedule = { type: 'interval', value: 60000 };
      const task: ScheduledTask = {
        taskId: 'test-1',
        workspaceId: 'workspace-1',
        description: 'Test task',
        schedule,
        status: 'pending',
        nextRunAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      storage.addTask(task);
      const retrieved = storage.getTask('test-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.taskId).toBe('test-1');
      expect(retrieved?.description).toBe('Test task');
      expect(retrieved?.schedule.type).toBe('interval');
    });
  });

  describe('getTask', () => {
    it('should return null for non-existent task', () => {
      const result = storage.getTask('non-existent');
      expect(result).toBeNull();
    });

    it('should retrieve existing task', () => {
      const task = createTestTask('test-1');
      storage.addTask(task);

      const result = storage.getTask('test-1');
      expect(result?.taskId).toBe('test-1');
    });
  });

  describe('getAllTasks', () => {
    it('should return empty array when no tasks', () => {
      const result = storage.getAllTasks();
      expect(result).toEqual([]);
    });

    it('should return all tasks ordered by nextRunAt', () => {
      const now = new Date();
      const task1 = createTestTask('task-1', { nextRunAt: new Date(now.getTime() + 60000).toISOString() });
      const task2 = createTestTask('task-2', { nextRunAt: new Date(now.getTime() + 30000).toISOString() });
      const task3 = createTestTask('task-3', { nextRunAt: new Date(now.getTime() + 90000).toISOString() });

      storage.addTask(task1);
      storage.addTask(task2);
      storage.addTask(task3);

      const result = storage.getAllTasks();
      expect(result.length).toBe(3);
      expect(result[0].taskId).toBe('task-2'); // Earliest first
      expect(result[1].taskId).toBe('task-1');
      expect(result[2].taskId).toBe('task-3');
    });
  });

  describe('getTasksByWorkspace', () => {
    it('should filter tasks by workspace', () => {
      const task1 = createTestTask('task-1', { workspaceId: 'workspace-a' });
      const task2 = createTestTask('task-2', { workspaceId: 'workspace-b' });
      const task3 = createTestTask('task-3', { workspaceId: 'workspace-a' });

      storage.addTask(task1);
      storage.addTask(task2);
      storage.addTask(task3);

      const result = storage.getTasksByWorkspace('workspace-a');
      expect(result.length).toBe(2);
      expect(result.every(t => t.workspaceId === 'workspace-a')).toBe(true);
    });
  });

  describe('getDueTasks', () => {
    it('should return only due tasks', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000).toISOString();
      const future = new Date(now.getTime() + 60000).toISOString();

      const dueTask = createTestTask('due-task', { nextRunAt: past });
      const notDueTask = createTestTask('not-due-task', { nextRunAt: future });

      storage.addTask(dueTask);
      storage.addTask(notDueTask);

      const result = storage.getDueTasks();
      expect(result.length).toBe(1);
      expect(result[0].taskId).toBe('due-task');
    });

    it('should only return pending or running tasks', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000).toISOString();

      const pendingTask = createTestTask('pending', { nextRunAt: past, status: 'pending' });
      const runningTask = createTestTask('running', { nextRunAt: past, status: 'running' });
      const completedTask = createTestTask('completed', { nextRunAt: past, status: 'completed' });
      const cancelledTask = createTestTask('cancelled', { nextRunAt: past, status: 'cancelled' });

      storage.addTask(pendingTask);
      storage.addTask(runningTask);
      storage.addTask(completedTask);
      storage.addTask(cancelledTask);

      const result = storage.getDueTasks();
      expect(result.length).toBe(2);
      expect(result.map(t => t.taskId)).toContain('pending');
      expect(result.map(t => t.taskId)).toContain('running');
    });
  });

  describe('updateStatus', () => {
    it('should update task status', () => {
      const task = createTestTask('test-1', { status: 'pending' });
      storage.addTask(task);

      storage.updateStatus('test-1', 'running');
      const result = storage.getTask('test-1');

      expect(result?.status).toBe('running');
    });
  });

  describe('updateAfterRun', () => {
    it('should update task after successful run', () => {
      const task = createTestTask('test-1');
      storage.addTask(task);

      const result: TaskResult = {
        success: true,
        output: 'Task completed',
        completedAt: new Date().toISOString(),
      };

      const nextRun = new Date(Date.now() + 60000).toISOString();
      storage.updateAfterRun('test-1', result, nextRun);

      const updated = storage.getTask('test-1');
      expect(updated?.status).toBe('completed');
      expect(updated?.result?.success).toBe(true);
      expect(updated?.result?.output).toBe('Task completed');
      expect(updated?.nextRunAt).toBe(nextRun);
      expect(updated?.runCount).toBe(1);
    });

    it('should update task after failed run', () => {
      const task = createTestTask('test-1');
      storage.addTask(task);

      const result: TaskResult = {
        success: false,
        error: 'Something went wrong',
        completedAt: new Date().toISOString(),
      };

      storage.updateAfterRun('test-1', result);

      const updated = storage.getTask('test-1');
      expect(updated?.status).toBe('failed');
      expect(updated?.result?.success).toBe(false);
      expect(updated?.result?.error).toBe('Something went wrong');
    });

    it('should increment run count on each run', () => {
      const task = createTestTask('test-1');
      storage.addTask(task);

      const result: TaskResult = {
        success: true,
        completedAt: new Date().toISOString(),
      };

      storage.updateAfterRun('test-1', result, new Date(Date.now() + 60000).toISOString());
      storage.updateAfterRun('test-1', result, new Date(Date.now() + 120000).toISOString());

      const updated = storage.getTask('test-1');
      expect(updated?.runCount).toBe(2);
    });
  });

  describe('deleteTask', () => {
    it('should delete existing task', () => {
      const task = createTestTask('test-1');
      storage.addTask(task);

      const deleted = storage.deleteTask('test-1');
      expect(deleted).toBe(true);
      expect(storage.getTask('test-1')).toBeNull();
    });

    it('should return false for non-existent task', () => {
      const deleted = storage.deleteTask('non-existent');
      expect(deleted).toBe(false);
    });
  });
});

// Helper function to create test tasks
function createTestTask(
  taskId: string,
  options: Partial<ScheduledTask> = {}
): ScheduledTask {
  const defaults: ScheduledTask = {
    taskId,
    workspaceId: 'default-workspace',
    description: `Test task ${taskId}`,
    schedule: { type: 'interval', value: 60000 },
    status: 'pending',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  return { ...defaults, ...options };
}
