import { afterEach, describe, expect, it } from 'vitest';
import path from 'path';
import { getConfigPath, getSquireDir } from './config.js';

describe('Squire core config isolation', () => {
  const originalDir = process.env.SQUIRE_DIR;

  afterEach(() => {
    if (originalDir === undefined) {
      delete process.env.SQUIRE_DIR;
    } else {
      process.env.SQUIRE_DIR = originalDir;
    }
  });

  it('uses SQUIRE_DIR instead of ~/.squire', () => {
    process.env.SQUIRE_DIR = '/tmp/squire-dev-core';
    expect(getSquireDir()).toBe(path.resolve('/tmp/squire-dev-core'));
    expect(getConfigPath()).toBe(path.join(path.resolve('/tmp/squire-dev-core'), 'config.json'));
  });
});
