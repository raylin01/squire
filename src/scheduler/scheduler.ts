/**
 * Scheduler
 *
 * Main scheduler for daemon mode task execution.
 */

import { v4 as uuid } from 'uuid';
import type { ScheduledTask, TaskSchedule, TaskResult } from '../types.js';
import { TaskStorage } from './storage.js';
import { parseSchedule, calculateNextRun } from './parser.js';

export interface SchedulerOptions {
  dbPath: string;
  pollInterval?: number;
  onTaskDue?: (task: ScheduledTask) => Promise<TaskResult>;
}

export type TaskExecutor = (task: ScheduledTask) => Promise<TaskResult>;

export class Scheduler {
  private storage: TaskStorage;
  private pollInterval: number;
  private onTaskDue?: TaskExecutor;
  private intervalId: NodeJS.Timeout | null = null;
  private running: boolean = false;

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

    // Check immediately
    this.poll();

    // Then poll on interval
    this.intervalId = setInterval(() => this.poll(), this.pollInterval);
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
  schedule(workspaceId: string, description: string, schedule: TaskSchedule): ScheduledTask {
    const parsed = parseSchedule(schedule);

    const task: ScheduledTask = {
      taskId: uuid(),
      workspaceId,
      description,
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

  /**
   * Set the task executor
   */
  setExecutor(executor: TaskExecutor): void {
    this.onTaskDue = executor;
  }

  /**
   * Poll for due tasks and execute them
   */
  private async poll(): Promise<void> {
    const dueTasks = this.storage.getDueTasks();

    if (dueTasks.length === 0) {
      return;
    }

    console.log(`[Scheduler] Found ${dueTasks.length} due task(s)`);

    for (const task of dueTasks) {
      await this.executeTask(task);
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    console.log(`[Scheduler] Executing task ${task.taskId}: "${task.description}"`);

    // Mark as running
    this.storage.updateStatus(task.taskId, 'running');

    let result: TaskResult;

    try {
      if (this.onTaskDue) {
        result = await this.onTaskDue(task);
      } else {
        // Default: just mark as completed
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

    // Calculate next run for repeating tasks
    let nextRunAt: string | undefined;
    if (task.schedule.type !== 'once') {
      try {
        const next = calculateNextRun(task.schedule, new Date());
        nextRunAt = next.toISOString();
        console.log(`[Scheduler] Task ${task.taskId} next run: ${nextRunAt}`);
      } catch {
        // Task cannot be rescheduled
        console.log(`[Scheduler] Task ${task.taskId} completed (no repeat)`);
      }
    }

    // Update task
    this.storage.updateAfterRun(task.taskId, result, nextRunAt);

    console.log(`[Scheduler] Task ${task.taskId} ${result.success ? 'completed' : 'failed'}`);
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
