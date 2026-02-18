import { describe, it, expect, beforeEach } from 'vitest';
import { parseSchedule, calculateNextRun, schedules } from './parser.js';
import type { TaskSchedule } from '../types.js';

describe('Schedule Parser', () => {
  describe('parseSchedule', () => {
    describe('once schedule', () => {
      it('should parse ISO date string', () => {
        const futureDate = new Date('2025-12-25T10:00:00Z');
        const schedule: TaskSchedule = { type: 'once', value: futureDate.toISOString() };
        const result = parseSchedule(schedule);

        expect(result.type).toBe('once');
        expect(result.nextRunAt.toISOString()).toBe(futureDate.toISOString());
      });

      it('should parse timestamp number', () => {
        const timestamp = Date.now() + 3600000; // 1 hour from now
        const schedule: TaskSchedule = { type: 'once', value: timestamp };
        const result = parseSchedule(schedule);

        expect(result.type).toBe('once');
        expect(result.nextRunAt.getTime()).toBe(timestamp);
      });

      it('should throw on invalid date', () => {
        const schedule: TaskSchedule = { type: 'once', value: 'invalid-date' };
        expect(() => parseSchedule(schedule)).toThrow('Invalid date');
      });
    });

    describe('interval schedule', () => {
      it('should parse interval in milliseconds', () => {
        const baseDate = new Date('2025-01-01T12:00:00Z');
        const schedule: TaskSchedule = { type: 'interval', value: 60000 }; // 1 minute
        const result = parseSchedule(schedule, baseDate);

        expect(result.type).toBe('interval');
        expect(result.intervalMs).toBe(60000);
        expect(result.nextRunAt.getTime()).toBe(baseDate.getTime() + 60000);
      });

      it('should throw on invalid interval', () => {
        const schedule: TaskSchedule = { type: 'interval', value: -1000 };
        expect(() => parseSchedule(schedule)).toThrow('Invalid interval');
      });

      it('should throw on non-number interval', () => {
        const schedule = { type: 'interval', value: 'not-a-number' } as unknown as TaskSchedule;
        expect(() => parseSchedule(schedule)).toThrow('Invalid interval');
      });
    });

    describe('cron schedule', () => {
      it('should parse cron expression with 5 parts', () => {
        const schedule: TaskSchedule = { type: 'cron', value: '*/5 * * * *' };
        const result = parseSchedule(schedule);

        expect(result.type).toBe('cron');
        expect(result.cronExpression).toBe('*/5 * * * *');
        expect(result.nextRunAt).toBeInstanceOf(Date);
      });

      it('should throw on invalid cron expression', () => {
        const schedule: TaskSchedule = { type: 'cron', value: 'invalid' };
        expect(() => parseSchedule(schedule)).toThrow('Invalid cron expression');
      });

      it('should parse every N minutes pattern', () => {
        const baseDate = new Date('2025-01-01T12:00:00Z');
        const schedule: TaskSchedule = { type: 'cron', value: '*/15 * * * *' };
        const result = parseSchedule(schedule, baseDate);

        expect(result.nextRunAt.getTime()).toBe(baseDate.getTime() + 15 * 60 * 1000);
      });

      it('should parse hourly at minute pattern', () => {
        const baseDate = new Date('2025-01-01T12:30:00Z');
        const schedule: TaskSchedule = { type: 'cron', value: '0 * * * *' };
        const result = parseSchedule(schedule, baseDate);

        expect(result.nextRunAt.getUTCMinutes()).toBe(0);
        // Hour should be 13 (next hour) in UTC since base is 12:30
        expect(result.nextRunAt.getUTCHours()).toBe(13);
      });
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next interval run', () => {
      const lastRun = new Date('2025-01-01T12:00:00Z');
      const schedule: TaskSchedule = { type: 'interval', value: 300000 }; // 5 minutes
      const result = calculateNextRun(schedule, lastRun);

      expect(result.getTime()).toBe(lastRun.getTime() + 300000);
    });

    it('should throw for once schedule', () => {
      const lastRun = new Date();
      const schedule: TaskSchedule = { type: 'once', value: Date.now() };

      expect(() => calculateNextRun(schedule, lastRun)).toThrow('Once tasks cannot be rescheduled');
    });

    it('should calculate next cron run', () => {
      const lastRun = new Date('2025-01-01T12:00:00Z');
      const schedule: TaskSchedule = { type: 'cron', value: '*/10 * * * *' };
      const result = calculateNextRun(schedule, lastRun);

      expect(result.getTime()).toBe(lastRun.getTime() + 10 * 60 * 1000);
    });
  });

  describe('schedule helpers', () => {
    it('should create interval schedule in minutes', () => {
      const schedule = schedules.inMinutes(5);
      expect(schedule.type).toBe('interval');
      expect(schedule.value).toBe(5 * 60 * 1000);
    });

    it('should create interval schedule in hours', () => {
      const schedule = schedules.inHours(2);
      expect(schedule.type).toBe('interval');
      expect(schedule.value).toBe(2 * 60 * 60 * 1000);
    });

    it('should create interval schedule in days', () => {
      const schedule = schedules.inDays(3);
      expect(schedule.type).toBe('interval');
      expect(schedule.value).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('should create cron schedule at specific time', () => {
      const schedule = schedules.atTime(14, 30);
      expect(schedule.type).toBe('cron');
      expect(schedule.value).toBe('30 14 * * *');
    });

    it('should create daily schedule', () => {
      const schedule = schedules.daily(9, 15);
      expect(schedule.type).toBe('cron');
      expect(schedule.value).toBe('15 9 * * *');
    });

    it('should create hourly schedule', () => {
      const schedule = schedules.hourly(30);
      expect(schedule.type).toBe('cron');
      expect(schedule.value).toBe('30 * * * *');
    });

    it('should create every N minutes schedule', () => {
      const schedule = schedules.everyMinutes(5);
      expect(schedule.type).toBe('cron');
      expect(schedule.value).toBe('*/5 * * * *');
    });

    it('should create once schedule from date', () => {
      const date = new Date('2025-06-15T10:00:00Z');
      const schedule = schedules.once(date);
      expect(schedule.type).toBe('once');
      expect(schedule.value).toBe(date.toISOString());
    });
  });
});
