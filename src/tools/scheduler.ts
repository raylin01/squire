/**
 * Squire Scheduler Tools
 *
 * Tools for scheduling tasks and reminders.
 */

import { defineTool } from './registry.js';
import type { Scheduler } from '../scheduler/scheduler.js';

let scheduler: Scheduler | null = null;

/**
 * Set the scheduler for the tools to use.
 */
export function setScheduler(s: Scheduler): void {
  scheduler = s;
}

// schedule_task - Schedule a new task
defineTool(
  'schedule_task',
  'Schedule a task to run at a specific time or interval. Use this for reminders, recurring tasks, or delayed actions.',
  {
    description: {
      type: 'string',
      description: 'Description of what to do when the task runs',
    },
    schedule: {
      type: 'string',
      description: 'Schedule expression: "in X minutes/hours/days", "every X minutes/hours", "at HH:MM", or cron expression',
    },
  },
  ['description', 'schedule'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const description = input.description as string;
    const scheduleStr = input.schedule as string;

    try {
      // Parse schedule string
      const schedule = parseScheduleString(scheduleStr);

      const task = scheduler.schedule('default', description, schedule);

      return `Task scheduled: "${description}"\nTask ID: ${task.taskId}\nNext run: ${task.nextRunAt}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to schedule task: ${message}`;
    }
  }
);

// schedule_list - List scheduled tasks
defineTool(
  'schedule_list',
  'List all scheduled tasks.',
  {},
  [],
  async (_input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const tasks = scheduler.getTasks();

    if (tasks.length === 0) {
      return 'No scheduled tasks';
    }

    const formatted = tasks.map((t, i) => {
      const status = t.status === 'pending' ? '⏳' : t.status === 'running' ? '🔄' : '✅';
      return `${i + 1}. ${status} ${t.description}\n   ID: ${t.taskId}\n   Next: ${t.nextRunAt}`;
    }).join('\n\n');

    return `Scheduled tasks (${tasks.length}):\n\n${formatted}`;
  }
);

// schedule_cancel - Cancel a scheduled task
defineTool(
  'schedule_cancel',
  'Cancel a scheduled task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to cancel',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const taskId = input.taskId as string;

    const cancelled = scheduler.cancel(taskId);

    if (cancelled) {
      return `Task ${taskId} cancelled`;
    } else {
      return `Task not found: ${taskId}`;
    }
  }
);

// schedule_get - Get task details
defineTool(
  'schedule_get',
  'Get details about a specific scheduled task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const taskId = input.taskId as string;
    const task = scheduler.getTask(taskId);

    if (!task) {
      return `Task not found: ${taskId}`;
    }

    return `Task: ${task.description}\nID: ${task.taskId}\nStatus: ${task.status}\nSchedule: ${JSON.stringify(task.schedule)}\nNext run: ${task.nextRunAt}\nCreated: ${task.createdAt}`;
  }
);

// Helper to parse schedule strings
function parseScheduleString(str: string): { type: 'once' | 'interval' | 'cron'; value: string | number } {
  const lower = str.toLowerCase().trim();

  // "in X minutes/hours/days"
  const inMatch = lower.match(/^in\s+(\d+)\s+(minute|hour|day)s?$/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const ms = unit === 'minute' ? 60000 : unit === 'hour' ? 3600000 : 86400000;
    const date = new Date(Date.now() + amount * ms);
    return { type: 'once', value: date.toISOString() };
  }

  // "every X minutes/hours"
  const everyMatch = lower.match(/^every\s+(\d+)\s+(minute|hour)s?$/);
  if (everyMatch) {
    const amount = parseInt(everyMatch[1]);
    const unit = everyMatch[2];
    const ms = unit === 'minute' ? 60000 : 3600000;
    return { type: 'interval', value: amount * ms };
  }

  // "at HH:MM"
  const atMatch = lower.match(/^at\s+(\d{1,2}):(\d{2})$/);
  if (atMatch) {
    const hours = parseInt(atMatch[1]);
    const minutes = parseInt(atMatch[2]);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
    return { type: 'once', value: date.toISOString() };
  }

  // Assume cron expression
  return { type: 'cron', value: str };
}
