import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CoreMemoryManager } from './core-memory.js';

describe('CoreMemoryManager', () => {
  let tempDir: string;
  let manager: CoreMemoryManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-memory-'));
    manager = new CoreMemoryManager({ memoryDir: tempDir, squireName: 'Test' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves entry ids and timestamps across reload', async () => {
    const first = await manager.add('Prefers TypeScript', { type: 'preference' });
    const reloaded = new CoreMemoryManager({ memoryDir: tempDir, squireName: 'Test' });
    await reloaded.load();
    const loaded = reloaded.search('TypeScript')[0];
    expect(loaded?.id).toBe(first.id);
    expect(loaded?.createdAt).toBe(first.createdAt);
  });

  it('keeps concurrent writes instead of last-writer-win dropping entries', async () => {
    await Promise.all([
      manager.add('Fact A', { type: 'fact' }),
      manager.add('Fact B', { type: 'fact' }),
      manager.add('Fact C', { type: 'fact' }),
    ]);

    expect(manager.getAll().map((entry) => entry.content).sort()).toEqual([
      'Fact A',
      'Fact B',
      'Fact C',
    ]);

    const reloaded = new CoreMemoryManager({ memoryDir: tempDir, squireName: 'Test' });
    await reloaded.load();
    expect(reloaded.getAll()).toHaveLength(3);
  });
});
