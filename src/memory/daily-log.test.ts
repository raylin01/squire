import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DailyLogManager } from './daily-log.js';

describe('DailyLogManager', () => {
  let tempDir: string;
  let manager: DailyLogManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-daily-'));
    manager = new DailyLogManager({ memoryDir: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps concurrent notes instead of last-writer-win', async () => {
    await Promise.all([
      manager.addNote('Note A'),
      manager.addNote('Note B'),
      manager.addNote('Note C'),
    ]);

    const log = await manager.getTodayLog();
    expect(log.entries.map((entry) => entry.content).sort()).toEqual([
      'Note A',
      'Note B',
      'Note C',
    ]);
  });
});
