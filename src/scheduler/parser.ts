/**
 * Schedule Parser
 *
 * Parses schedule expressions and calculates next run times.
 */

import type { TaskSchedule } from '../types.js';

export interface ParsedSchedule {
  type: 'once' | 'interval' | 'cron';
  nextRunAt: Date;
  intervalMs?: number;
  cronExpression?: string;
}

export function parseSchedule(schedule: TaskSchedule, baseDate: Date = new Date()): ParsedSchedule {
  switch (schedule.type) {
    case 'once':
      return parseOnceSchedule(schedule.value as string | number, baseDate);

    case 'interval':
      return parseIntervalSchedule(schedule.value as number, baseDate);

    case 'cron':
      return parseCronSchedule(schedule.value as string, baseDate);

    default:
      throw new Error(`Unknown schedule type: ${String((schedule as { type?: string }).type)}`);
  }
}

function parseOnceSchedule(value: string | number, baseDate: Date): ParsedSchedule {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date for 'once' schedule: ${value}`);
  }

  return {
    type: 'once',
    nextRunAt: date
  };
}

function parseIntervalSchedule(valueMs: number, baseDate: Date): ParsedSchedule {
  if (typeof valueMs !== 'number' || valueMs <= 0) {
    throw new Error(`Invalid interval: ${valueMs}`);
  }

  return {
    type: 'interval',
    nextRunAt: new Date(baseDate.getTime() + valueMs),
    intervalMs: valueMs
  };
}

function parseCronSchedule(expression: string, baseDate: Date): ParsedSchedule {
  // Simplified cron parser - validates format
  const parts = expression.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }

  // Use a simple approximation for MVP
  const nextRun = calculateNextCronRun(expression, baseDate);

  return {
    type: 'cron',
    nextRunAt: nextRun,
    cronExpression: expression
  };
}

function calculateNextCronRun(expression: string, baseDate: Date): Date {
  // TODO: Use proper cron library (cron-parser or node-cron)
  // For MVP, parse simple patterns
  const parts = expression.split(' ');
  const minute = parts[0];
  const hour = parts[1];

  // Handle "every X minutes" pattern: */X * * * *
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2), 10);
    if (!isNaN(interval)) {
      return new Date(baseDate.getTime() + interval * 60 * 1000);
    }
  }

  // Handle "every hour at minute X": X * * * *
  if (minute !== '*' && hour === '*') {
    const targetMinute = parseInt(minute, 10);
    if (!isNaN(targetMinute)) {
      const next = new Date(baseDate);
      next.setMinutes(targetMinute, 0, 0);
      if (next <= baseDate) {
        next.setHours(next.getHours() + 1);
      }
      return next;
    }
  }

  // Default: 1 hour from now
  console.warn('[Scheduler] Cron parsing limited, defaulting to 1 hour');
  return new Date(baseDate.getTime() + 60 * 60 * 1000);
}

export function calculateNextRun(
  schedule: TaskSchedule,
  lastRunAt: Date
): Date {
  const parsed = parseSchedule(schedule, lastRunAt);

  if (parsed.type === 'once') {
    throw new Error('Once tasks cannot be rescheduled');
  }

  if (parsed.type === 'interval' && parsed.intervalMs) {
    return new Date(lastRunAt.getTime() + parsed.intervalMs);
  }

  if (parsed.type === 'cron' && parsed.cronExpression) {
    return calculateNextCronRun(parsed.cronExpression, lastRunAt);
  }

  throw new Error('Could not calculate next run');
}

// Helper to create common schedules
export const schedules = {
  inMinutes: (minutes: number): TaskSchedule => ({
    type: 'interval',
    value: minutes * 60 * 1000
  }),

  inHours: (hours: number): TaskSchedule => ({
    type: 'interval',
    value: hours * 60 * 60 * 1000
  }),

  inDays: (days: number): TaskSchedule => ({
    type: 'interval',
    value: days * 24 * 60 * 60 * 1000
  }),

  atTime: (hour: number, minute: number = 0): TaskSchedule => ({
    type: 'cron',
    value: `${minute} ${hour} * * *`
  }),

  daily: (hour: number = 9, minute: number = 0): TaskSchedule => ({
    type: 'cron',
    value: `${minute} ${hour} * * *`
  }),

  hourly: (minute: number = 0): TaskSchedule => ({
    type: 'cron',
    value: `${minute} * * * *`
  }),

  everyMinutes: (minutes: number): TaskSchedule => ({
    type: 'cron',
    value: `*/${minutes} * * * *`
  }),

  once: (date: Date): TaskSchedule => ({
    type: 'once',
    value: date.toISOString()
  }),

  onceIn: (ms: number): TaskSchedule => ({
    type: 'once',
    value: new Date(Date.now() + ms).toISOString()
  })
};
