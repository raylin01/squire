/**
 * Squire Core Tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Squire } from '../dist/squire.js';
import { resolveConfig, validateConfig } from '../dist/config.js';
import type { SquireConfig } from '../dist/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), `squire-test-${Date.now()}`);

describe('Squire Core', () => {
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Configuration', () => {
    it('should create default config', () => {
      const config = resolveConfig({ squireId: 'test-squire' });

      assert.ok(config.squireId);
      assert.strictEqual(config.squireId, 'test-squire');
      assert.strictEqual(config.name, 'Squire');
      assert.strictEqual(config.model, 'claude-sonnet-4-20250514');
      assert.strictEqual(config.daemonMode, false);
      assert.strictEqual(config.memory.enabled, true);
    });

    it('should merge partial config', () => {
      const config = resolveConfig({
        squireId: 'test-squire',
        name: 'CustomName',
        daemonMode: true,
        memory: {
          enabled: true,
          provider: 'openai',
          retentionDays: 30,
        },
      });

      assert.strictEqual(config.name, 'CustomName');
      assert.strictEqual(config.daemonMode, true);
      assert.strictEqual(config.memory.provider, 'openai');
      assert.strictEqual(config.memory.retentionDays, 30);
    });

    it('should validate config', () => {
      const validConfig = resolveConfig({ squireId: 'test-squire' });
      const result = validateConfig(validConfig);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should detect invalid config', () => {
      const result = validateConfig({
        squireId: '',
        name: '',
        model: '',
        dataDir: '',
        memoryDbPath: '',
        skillsDir: '',
        daemonMode: false,
        pollInterval: 100,
        memory: { enabled: true, provider: 'local', retentionDays: 90 },
        skills: { bundled: [], additional: [], autoInstall: true },
        permissions: { mode: 'invalid' as any, allowedTools: [], blockedTools: [] },
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });
  });

  describe('Squire Class', () => {
    it('should create instance', () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      assert.ok(squire);
      assert.strictEqual(squire.isRunning(), false);
    });

    it('should start and stop', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      await squire.start();
      assert.strictEqual(squire.isRunning(), true);

      await squire.stop();
      assert.strictEqual(squire.isRunning(), false);
    });

    it('should create workspace', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      await squire.start();

      const workspace = await squire.createWorkspace({
        name: 'Test Workspace',
        source: 'cli',
        sourceId: 'test-1',
      });

      assert.ok(workspace.workspaceId);
      assert.strictEqual(workspace.name, 'Test Workspace');
      assert.strictEqual(workspace.source, 'cli');
      assert.strictEqual(workspace.status, 'active');

      await squire.stop();
    });

    it('should get workspace by source', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      await squire.start();

      await squire.createWorkspace({
        name: 'Test Workspace',
        source: 'discord_channel',
        sourceId: 'channel-123',
      });

      const found = squire.getWorkspaceBySource('discord_channel', 'channel-123');
      assert.ok(found);
      assert.strictEqual(found?.name, 'Test Workspace');

      const notFound = squire.getWorkspaceBySource('discord_dm', 'nonexistent');
      assert.strictEqual(notFound, undefined);

      await squire.stop();
    });

    it('should set active workspace', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      await squire.start();

      const workspace = await squire.createWorkspace({
        name: 'Test Workspace',
        source: 'cli',
        sourceId: 'test-1',
      });

      squire.setActiveWorkspace(workspace.workspaceId);

      const active = squire.getActiveWorkspace();
      assert.ok(active);
      assert.strictEqual(active?.workspaceId, workspace.workspaceId);

      await squire.stop();
    });

    it('should emit events', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
      });

      let eventReceived = false;
      squire.on('workspace_created', () => {
        eventReceived = true;
      });

      await squire.start();
      await squire.createWorkspace({
        name: 'Test Workspace',
        source: 'cli',
        sourceId: 'test-1',
      });

      assert.strictEqual(eventReceived, true);

      await squire.stop();
    });

    it('should throw when memory not enabled', async () => {
      const squire = new Squire({
        squireId: 'test-squire',
        dataDir: TEST_DIR,
        memory: { enabled: false, provider: 'local', retentionDays: 90 },
      });

      await squire.start();

      await assert.rejects(
        async () => await squire.remember('test'),
        /Memory system is not enabled/
      );

      await squire.stop();
    });
  });
});
