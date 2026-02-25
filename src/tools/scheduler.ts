/**
 * Squire Scheduler Tools
 *
 * Tools for scheduling tasks and reminders.
 */

import { CronExpressionParser } from 'cron-parser';
import { defineTool, getExecutionContext } from './registry.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { TaskSchedule } from '../types.js';

let scheduler: Scheduler | null = null;
let getWorkspaceTimezone: ((workspaceId: string) => string | undefined) | null = null;
let setWorkspaceTimezone: ((workspaceId: string, timezone: string) => Promise<void> | void) | null = null;

/**
 * Set the scheduler for the tools to use.
 */
export function setScheduler(s: Scheduler): void {
  scheduler = s;
}

export function setSchedulerWorkspaceAccessors(accessors: {
  getTimezone: (workspaceId: string) => string | undefined;
  setTimezone: (workspaceId: string, timezone: string) => Promise<void> | void;
}): void {
  getWorkspaceTimezone = accessors.getTimezone;
  setWorkspaceTimezone = accessors.setTimezone;
}

function validateTimezone(timezone: string): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
    if (!formatted) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
    return formatted;
  } catch {
    throw new Error(`Invalid timezone "${timezone}". Use an IANA timezone like "America/New_York".`);
  }
}

function parseScheduleString(
  str: string,
  options?: { timezone?: string }
): TaskSchedule {
  const lower = str.toLowerCase().trim();

  // "in X minutes/hours/days"
  const inMatch = lower.match(/^in\s+(\d+)\s+(minute|hour|day)s?$/);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const ms = unit === 'minute' ? 60000 : unit === 'hour' ? 3600000 : 86400000;
    const date = new Date(Date.now() + amount * ms);
    return { type: 'once', value: date.toISOString() };
  }

  // "every X minutes/hours"
  const everyMatch = lower.match(/^every\s+(\d+)\s+(minute|hour)s?$/);
  if (everyMatch) {
    const amount = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    const ms = unit === 'minute' ? 60000 : 3600000;
    return { type: 'interval', value: amount * ms };
  }

  // "at HH:MM" => one-time next occurrence in workspace timezone.
  const atMatch = lower.match(/^at\s+(\d{1,2}):(\d{2})$/);
  if (atMatch) {
    if (!options?.timezone) {
      throw new Error(
        'Clock-time schedules require a workspace timezone. Ask the user for timezone and call schedule_task with timezone.'
      );
    }

    const hours = parseInt(atMatch[1], 10);
    const minutes = parseInt(atMatch[2], 10);
    if (hours > 23 || minutes > 59) {
      throw new Error(`Invalid time: ${atMatch[1]}:${atMatch[2]}`);
    }

    const cron = `${minutes} ${hours} * * *`;
    const interval = CronExpressionParser.parse(cron, {
      currentDate: new Date(),
      tz: options.timezone,
    });

    return { type: 'once', value: interval.next().toDate().toISOString() };
  }

  // Assume cron expression.
  return { type: 'cron', value: str };
}

// schedule_task - Schedule a new task
defineTool(
  'schedule_task',
  'Schedule a workspace task to run at a specific time or interval. Tasks are always created in the current workspace.',
  {
    description: {
      type: 'string',
      description: 'Description/objective of what Squire should do when the task runs.',
    },
    schedule: {
      type: 'string',
      description: 'Schedule expression: "in X minutes/hours/days", "every X minutes/hours", "at HH:MM", or cron expression.',
    },
    context: {
      type: 'string',
      description: 'Optional additional context Squire should remember for this scheduled run.',
    },
    timezone: {
      type: 'string',
      description: 'Optional IANA timezone (e.g., America/New_York). If provided, it is saved to this workspace.',
    },
  },
  ['description', 'schedule'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const execution = getExecutionContext();
    const workspaceId = execution.workspaceId;
    if (!workspaceId) {
      return 'Cannot schedule task: no workspace context.';
    }

    const description = String(input.description || '').trim();
    const scheduleStr = String(input.schedule || '').trim();
    const context = typeof input.context === 'string' ? input.context.trim() : undefined;
    const timezoneInput = typeof input.timezone === 'string' ? input.timezone.trim() : undefined;

    if (!description || !scheduleStr) {
      return 'Description and schedule are required.';
    }

    try {
      let timezone = getWorkspaceTimezone?.(workspaceId);
      if (timezoneInput) {
        timezone = validateTimezone(timezoneInput);
        await setWorkspaceTimezone?.(workspaceId, timezone);
      }

      const schedule = parseScheduleString(scheduleStr, { timezone });
      const task = scheduler.schedule(workspaceId, description, schedule, {
        timezone,
        payload: {
          objective: description,
          context,
          metadata: {
            createdBy: 'squire',
            scheduleExpression: scheduleStr,
          },
        },
      });

      const timezoneLine = task.timezone ? `\nTimezone: ${task.timezone}` : '';
      return `Task scheduled: "${description}"\nTask ID: ${task.taskId}\nNext run: ${task.nextRunAt}${timezoneLine}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to schedule task: ${message}`;
    }
  }
);

// schedule_list - List scheduled tasks
defineTool(
  'schedule_list',
  'List scheduled tasks. Defaults to current workspace tasks.',
  {
    scope: {
      type: 'string',
      description: 'Use "workspace" (default) or "all".',
      enum: ['workspace', 'all'],
    },
  },
  [],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const execution = getExecutionContext();
    const workspaceId = execution.workspaceId;
    const scope = String(input.scope || 'workspace');

    const tasks = scope === 'all' || !workspaceId
      ? scheduler.getTasks()
      : scheduler.getTasksByWorkspace(workspaceId);

    if (tasks.length === 0) {
      return 'No scheduled tasks';
    }

    const statusIcons: Record<string, string> = {
      pending: '⏳',
      running: '🔄',
      awaiting_user: '⚠️',
      paused: '⏸️',
      completed: '✅',
      failed: '❌',
      cancelled: '🚫',
    };

    const formatted = tasks.map((t, i) => {
      const status = statusIcons[t.status] || '•';
      return `${i + 1}. ${status} ${t.description}\n   ID: ${t.taskId}\n   Status: ${t.status}\n   Next: ${t.nextRunAt}`;
    }).join('\n\n');

    return `Scheduled tasks (${tasks.length}):\n\n${formatted}`;
  }
);

defineTool(
  'schedule_cancel',
  'Cancel (delete) a scheduled task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to cancel.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const taskId = String(input.taskId || '');
    const cancelled = scheduler.cancel(taskId);

    return cancelled ? `Task ${taskId} cancelled` : `Task not found: ${taskId}`;
  }
);

defineTool(
  'schedule_pause',
  'Pause a scheduled task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to pause.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) return 'Scheduler not initialized';
    const taskId = String(input.taskId || '');
    return scheduler.pause(taskId) ? `Task ${taskId} paused` : `Task not found or not pausable: ${taskId}`;
  }
);

defineTool(
  'schedule_resume',
  'Resume a paused or awaiting-user task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to resume.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) return 'Scheduler not initialized';
    const taskId = String(input.taskId || '');
    return scheduler.resume(taskId) ? `Task ${taskId} resumed` : `Task not found or not resumable: ${taskId}`;
  }
);

defineTool(
  'schedule_retry',
  'Retry a failed/awaiting task immediately.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to retry.',
    },
    autoFix: {
      type: 'boolean',
      description: 'If true, request an auto-fix pass before retrying.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) return 'Scheduler not initialized';
    const taskId = String(input.taskId || '');
    const autoFix = input.autoFix === true;
    return scheduler.retryNow(taskId, { autoFix })
      ? `Task ${taskId} queued for immediate retry${autoFix ? ' (auto-fix enabled)' : ''}`
      : `Task not found or not retryable: ${taskId}`;
  }
);

defineTool(
  'schedule_skip',
  'Skip the current failed run and move to the next schedule.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task to skip.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) return 'Scheduler not initialized';
    const taskId = String(input.taskId || '');
    return scheduler.skipCurrentRun(taskId)
      ? `Skipped current run for ${taskId}`
      : `Task not found or not skippable: ${taskId}`;
  }
);

defineTool(
  'schedule_get',
  'Get details about a specific scheduled task.',
  {
    taskId: {
      type: 'string',
      description: 'The ID of the task.',
    },
  },
  ['taskId'],
  async (input: Record<string, unknown>) => {
    if (!scheduler) {
      return 'Scheduler not initialized';
    }

    const taskId = String(input.taskId || '');
    const task = scheduler.getTask(taskId);

    if (!task) {
      return `Task not found: ${taskId}`;
    }

    return [
      `Task: ${task.description}`,
      `ID: ${task.taskId}`,
      `Kind: ${task.kind}`,
      `Status: ${task.status}`,
      `Timezone: ${task.timezone || 'unset'}`,
      `Schedule: ${JSON.stringify(task.schedule)}`,
      `Next run: ${task.nextRunAt}`,
      `Created: ${task.createdAt}`,
      `Objective: ${task.payload.objective}`,
      task.payload.context ? `Context: ${task.payload.context}` : '',
    ].filter(Boolean).join('\n');
  }
);
