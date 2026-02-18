import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager, createMemoryManager } from './manager.js';
import type { MemoryConfig } from '../types.js';

// Create mock callTool function
const mockCallTool = vi.fn();

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    callTool: mockCallTool,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let config: MemoryConfig;

  beforeEach(async () => {
    mockCallTool.mockReset();

    config = {
      enabled: true,
      provider: 'qmd',
      retentionDays: 90,
    };

    manager = new MemoryManager(config, '/tmp/test-data');
  });

  afterEach(async () => {
    if (manager.isInitialized()) {
      await manager.close();
    }
  });

  describe('constructor', () => {
    it('should create manager with config', () => {
      expect(manager).toBeInstanceOf(MemoryManager);
      expect(manager.isInitialized()).toBe(false);
    });

    it('should create manager using factory', () => {
      const factoryManager = createMemoryManager(config, '/tmp/test');
      expect(factoryManager).toBeInstanceOf(MemoryManager);
    });
  });

  describe('initialize', () => {
    it('should initialize the MCP client', async () => {
      await manager.initialize();
      expect(manager.isInitialized()).toBe(true);
    });

    it('should not initialize twice', async () => {
      await manager.initialize();
      await manager.initialize(); // Should be a no-op

      expect(manager.isInitialized()).toBe(true);
    });
  });

  describe('add', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should add a memory entry', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'mem-123' }],
      });

      const entry = await manager.add('Remember this', { source: 'user' });

      expect(entry.content).toBe('Remember this');
      expect(entry.source).toBe('user');
      expect(entry.id).toBeDefined();
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'qmd_remember',
        arguments: expect.objectContaining({
          content: 'Remember this',
        }),
      });
    });

    it('should add memory with metadata', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'mem-456' }],
      });

      const entry = await manager.add('Test', {
        source: 'skill',
        workspaceId: 'workspace-1',
        metadata: { importance: 'high' },
      });

      expect(entry.workspaceId).toBe('workspace-1');
      expect(entry.metadata).toEqual(
        expect.objectContaining({ importance: 'high', source: 'skill' })
      );
    });

    it('should default source to user', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'mem-789' }],
      });

      const entry = await manager.add('No source specified');

      expect(entry.source).toBe('user');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should search memories', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([
            { id: 'mem-1', content: 'First result', score: 0.9, metadata: {} },
            { id: 'mem-2', content: 'Second result', score: 0.7, metadata: {} },
          ]),
        }],
      });

      const results = await manager.search('test query');

      expect(results.length).toBe(2);
      expect(results[0].entry.content).toBe('First result');
      expect(results[0].score).toBe(0.9);
    });

    it('should return empty array on parse error', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'invalid json' }],
      });

      const results = await manager.search('query');

      expect(results).toEqual([]);
    });

    it('should return empty array on empty response', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '' }],
      });

      const results = await manager.search('query');

      expect(results).toEqual([]);
    });

    it('should pass limit option', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
      });

      await manager.search('query', { limit: 5 });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'qmd_recall',
        arguments: expect.objectContaining({ limit: 5 }),
      });
    });

    it('should pass filter options', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
      });

      await manager.search('query', {
        workspaceId: 'workspace-1',
        source: 'skill',
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'qmd_recall',
        arguments: expect.objectContaining({
          filter: { workspaceId: 'workspace-1', source: 'skill' },
        }),
      });
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should get a memory by ID', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([
            { id: 'mem-123', content: 'Found it', score: 1.0, metadata: {} },
          ]),
        }],
      });

      const entry = await manager.get('mem-123');

      expect(entry).not.toBeNull();
      expect(entry?.id).toBe('mem-123');
    });

    it('should return null if not found', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
      });

      const entry = await manager.get('nonexistent');

      expect(entry).toBeNull();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should delete a memory', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '1' }],
      });

      const deleted = await manager.delete('mem-123');

      expect(deleted).toBe(true);
    });

    it('should return false if nothing deleted', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '0' }],
      });

      const deleted = await manager.delete('nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('forget', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should forget memories matching query', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: '3' }],
      });

      const count = await manager.forget('old memories', 10);

      expect(count).toBe(3);
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'qmd_forget',
        arguments: { query: 'old memories', limit: 10 },
      });
    });
  });

  describe('reflect', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should call reflect tool', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Reflected' }],
      });

      await manager.reflect();

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'qmd_reflect',
        arguments: {},
      });
    });
  });

  describe('close', () => {
    it('should close the MCP client', async () => {
      await manager.initialize();
      await manager.close();

      expect(manager.isInitialized()).toBe(false);
    });

    it('should be safe to call when not initialized', async () => {
      await manager.close(); // Should not throw
    });
  });

  describe('error handling', () => {
    it('should throw if not initialized', async () => {
      await expect(manager.add('test')).rejects.toThrow('not initialized');
      await expect(manager.search('test')).rejects.toThrow('not initialized');
      await expect(manager.get('test')).rejects.toThrow('not initialized');
      await expect(manager.delete('test')).rejects.toThrow('not initialized');
      await expect(manager.forget('test')).rejects.toThrow('not initialized');
      await expect(manager.reflect()).rejects.toThrow('not initialized');
    });
  });
});
