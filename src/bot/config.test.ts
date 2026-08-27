import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfigPath, getSquireBotDir, loadConfig, saveConfig } from './config.js';

describe('SquireBot config isolation', () => {
  const originalDir = process.env.SQUIREBOT_DIR;
  let tempDir: string | undefined;

  afterEach(() => {
    if (originalDir === undefined) {
      delete process.env.SQUIREBOT_DIR;
    } else {
      process.env.SQUIREBOT_DIR = originalDir;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('uses SQUIREBOT_DIR instead of ~/.squirebot', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squirebot-dev-'));
    process.env.SQUIREBOT_DIR = tempDir;

    expect(getSquireBotDir()).toBe(path.resolve(tempDir));
    expect(getConfigPath()).toBe(path.join(path.resolve(tempDir), 'config.json'));
    expect(getConfigPath()).not.toContain(`${path.sep}.squirebot${path.sep}config.json`);
  });

  it('reads and writes only the isolated config file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squirebot-dev-'));
    process.env.SQUIREBOT_DIR = tempDir;

    saveConfig({
      discordToken: 'dev-token',
      discordAppId: 'dev-app',
      allowedUsers: ['user-1'],
      squire: { provider: 'claude', permissionMode: 'strict' },
    });

    const loaded = loadConfig();
    expect(loaded?.discordAppId).toBe('dev-app');
    expect(loaded?.allowedUsers).toEqual(['user-1']);
    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(true);
  });
});
