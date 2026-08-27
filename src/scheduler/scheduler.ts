/**
 * Scheduler
 *
 * Main scheduler for daemon mode task execution.
 */

import { v4 as uuid } from 'uuid';
import type { ScheduledTask, ScheduledTaskPayload, TaskResult, TaskSchedule } from '../types.js';
import { TaskStorage } from './storage.js';
import { parseSchedule, calculateNextRun } from './parser.js';

export interface SchedulerOptions {
  dbPath: string;
  pollInterval?: number;
  onTaskDue?: (task: ScheduledTask) => Promise<TaskResult>;
}

export interface ScheduleTaskOptions {
  payload?: ScheduledTaskPayload;
  timezone?: string;
}

export interface SchedulerLifecycleHandlers {
  onTaskCompleted?: (task: ScheduledTask, result: TaskResult) => Promise<void> | void;
  onTaskAwaitingUser?: (task: ScheduledTask, result: TaskResult) => Promise<void> | void;
}

export type TaskExecutor = (task: ScheduledTask) => Promise<TaskResult>;

export class Scheduler {
  private storage: TaskStorage;
  private pollInterval: number;
  private onTaskDue?: TaskExecutor;
  private lifecycleHandlers: SchedulerLifecycleHandlers = {};
  private intervalId: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private polling: boolean = false;

  constructor(options: SchedulerOptions) {
    this.storage = new TaskStorage(options.dbPath);
    this.pollInterval = options.pollInterval || 60000;
    this.onTaskDue = options.onTaskDue;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    console.log(`[Scheduler] Starting with poll interval ${this.pollInterval}ms`);

    // Check immediately.
    void this.poll();

    // Then poll on interval.
    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.pollInterval);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[Scheduler] Stopped');
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Schedule a new task
   */
  schedule(
    workspaceId: string,
    description: string,
    schedule: TaskSchedule,
    options?: ScheduleTaskOptions
  ): ScheduledTask {
    const parsed = parseSchedule(schedule, new Date(), { timezone: options?.timezone });

    const task: ScheduledTask = {
      taskId: uuid(),
      workspaceId,
      kind: 'self',
      description,
      payload: options?.payload || { objective: description },
      timezone: options?.timezone,
      schedule,
      status: 'pending',
      nextRunAt: parsed.nextRunAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.storage.addTask(task);
    console.log(`[Scheduler] Scheduled task ${task.taskId}: "${description}" for ${task.nextRunAt}`);

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | null {
    return this.storage.getTask(taskId);
  }

  /**
   * Get all tasks
   */
  getTasks(): ScheduledTask[] {
    return this.storage.getAllTasks();
  }

  /**
   * Get tasks by workspace
   */
  getTasksByWorkspace(workspaceId: string): ScheduledTask[] {
    return this.storage.getTasksByWorkspace(workspaceId);
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): boolean {
    const deleted = this.storage.deleteTask(taskId);
    if (deleted) {
      console.log(`[Scheduler] Cancelled task ${taskId}`);
    }
    return deleted;
  }

  pause(taskId: string): boolean {
    return this.storage.pauseTask(taskId);
  }

  resume(taskId: string): boolean {
    return this.storage.resumeTask(taskId);
  }

  retryNow(taskId: string, options?: { autoFix?: boolean }): boolean {
    const task = this.storage.getTask(taskId);
    if (!task) return false;

    if (options?.autoFix) {
      const updatedPayload: ScheduledTaskPayload = {
        ...task.payload,
        autoFixRequested: true,
        lastFailureSummary: task.result?.parsedSummary || task.result?.error || task.payload.lastFailureSummary,
      };
      this.storage.updatePayload(taskId, updatedPayload);
    }

    const changed = this.storage.retryNow(taskId);
    if (changed) {
      this.storage.recordLatestRunDecision(taskId, options?.autoFix ? 'auto_fix_retry' : 'retry_now');
    }
    return changed;
  }

  skipCurrentRun(taskId: string): boolean {
    const task = this.storage.getTask(taskId);
    if (!task) return false;

    // Skip for one-time tasks disables the task.
    if (task.schedule.type === 'once') {
      const disabled = this.storage.disableTask(taskId);
      if (disabled) {
        this.storage.recordLatestRunDecision(taskId, 'skip_run');
      }
      return disabled;
    }

    const nextRunAt = calculateNextRun(task.schedule, new Date(), { timezone: task.timezone }).toISOString();
    const changed = this.storage.skipRun(taskId, nextRunAt);
    if (changed) {
      this.storage.recordLatestRunDecision(taskId, 'skip_run');
    }
    return changed;
  }

  disable(taskId: string): boolean {
    const changed = this.storage.disableTask(taskId);
    if (changed) {
      this.storage.recordLatestRunDecision(taskId, 'disable_task');
    }
    return changed;
  }

  /**
   * Set the task executor
   */
  setExecutor(executor: TaskExecutor): void {
    this.onTaskDue = executor;
  }

  setLifecycleHandlers(handlers: SchedulerLifecycleHandlers): void {
    this.lifecycleHandlers = handlers;
  }

  /**
   * Poll for due tasks and execute them
   */
  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const dueTasks = this.storage.claimDueTasks();

      if (dueTasks.length === 0) {
        return;
      }

      console.log(`[Scheduler] Found ${dueTasks.length} due task(s)`);

      for (const task of dueTasks) {
        await this.executeTask(task);
      }
    } finally {
      this.polling = false;
    }
  }

  private summarizeFailure(task: ScheduledTask, result: TaskResult): { parsedSummary: string; suggestedFixes: string[] } {
    const raw = (result.error || 'Unknown error').trim();
    const parsedSummary = `Scheduled task "${task.description}" failed to run. ${raw}`;
    const suggestedFixes = [
      'Retry now if this looks transient.',
      'Skip this run and wait for the next schedule.',
      'Disable the task if it is no longer needed.',
      'Use auto-fix retry to let Squire attempt diagnostics before rerun.',
    ];
    return { parsedSummary, suggestedFixes };
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    let runnableTask = task;
    if (task.payload.autoFixRequested) {
      const normalizedPayload: ScheduledTaskPayload = {
        ...task.payload,
        autoFixRequested: false,
      };
      this.storage.updatePayload(task.taskId, normalizedPayload);
      runnableTask = { ...task, payload: normalizedPayload };
    }

    console.log(`[Scheduler] Executing task ${runnableTask.taskId}: "${runnableTask.description}"`);

    const runId = this.storage.startRun(runnableTask.taskId);

    let result: TaskResult;

    try {
      if (this.onTaskDue) {
        result = await this.onTaskDue(runnableTask);
      } else {
        result = {
          success: true,
          output: 'No executor configured',
          completedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
    }

    if (!result.completedAt) {
      result.completedAt = new Date().toISOString();
    }

    let nextRunAt: string | undefined;
    let status: ScheduledTask['status'] = 'completed';
    let awaitingReason: string | undefined;

    if (result.success) {
      if (runnableTask.schedule.type !== 'once') {
        nextRunAt = calculateNextRun(runnableTask.schedule, new Date(result.completedAt), { timezone: runnableTask.timezone }).toISOString();
        status = 'pending';
      } else {
        status = 'completed';
      }
    } else {
      status = 'awaiting_user';
      awaitingReason = result.error || 'Task failed';

      const parsed = this.summarizeFailure(runnableTask, result);
      result.parsedSummary = result.parsedSummary || parsed.parsedSummary;
      result.suggestedFixes = result.suggestedFixes || parsed.suggestedFixes;
    }

    this.storage.updateAfterRun({
      taskId: runnableTask.taskId,
      runId,
      result,
      status,
      nextRunAt,
      awaitingDecisionReason: awaitingReason,
    });

    const updated = this.storage.getTask(runnableTask.taskId);
    if (!updated) {
      return;
    }

    if (status === 'awaiting_user') {
      await this.lifecycleHandlers.onTaskAwaitingUser?.(updated, result);
    } else if (status === 'completed' || status === 'pending') {
      await this.lifecycleHandlers.onTaskCompleted?.(updated, result);
    }

    console.log(`[Scheduler] Task ${runnableTask.taskId} ${status}`);
  }

  /**
   * Close the scheduler and storage
   */
  close(): void {
    this.stop();
    this.storage.close();
  }
}

/**
 * Create a scheduler instance
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  return new Scheduler(options);
}
