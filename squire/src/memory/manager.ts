/**
 * Memory Manager
 *
 * Thin wrapper around QMD MCP server for persistent memory with
 * local embeddings and hybrid search.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MemoryEntry, MemorySearchResult, MemoryConfig, MemorySource } from '../types.js';
import path from 'path';

export interface MemoryAddOptions {
  source?: MemorySource;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  limit?: number;
  workspaceId?: string;
  source?: string;
}

export class MemoryManager {
  private config: MemoryConfig;
  private mcpClient: Client | null = null;
  private dataDir: string;
  private initialized: boolean = false;

  constructor(config: MemoryConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const qmdPath = this.config.qmdPath || 'qmd';
    const qmdDataDir = this.config.dataDir || path.join(this.dataDir, 'qmd');

    this.mcpClient = new Client(
      { name: 'squire-memory', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport({
      command: qmdPath,
      args: ['mcp', '--data-dir', qmdDataDir]
    });

    await this.mcpClient.connect(transport);
    this.initialized = true;
    console.log('[Memory] Connected to QMD');
  }

  async add(content: string, options?: MemoryAddOptions): Promise<MemoryEntry> {
    this.ensureInitialized();

    const metadata = {
      ...options?.metadata,
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
    };

    const result = await this.mcpClient!.callTool({
      name: 'qmd_remember',
      arguments: {
        content,
        metadata
      }
    });

    const id = this.extractTextContent(result.content);

    return {
      id: id || `mem-${Date.now()}`,
      content,
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
      metadata: metadata as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    this.ensureInitialized();

    const filter: Record<string, unknown> = {};
    if (options?.workspaceId) {
      filter.workspaceId = options.workspaceId;
    }
    if (options?.source) {
      filter.source = options.source;
    }

    const result = await this.mcpClient!.callTool({
      name: 'qmd_recall',
      arguments: {
        query,
        limit: options?.limit || 10,
        filter: Object.keys(filter).length > 0 ? filter : undefined
      }
    });

    const text = this.extractTextContent(result.content);
    if (!text) return [];

    try {
      const results = JSON.parse(text);
      return results.map((r: Record<string, unknown>) => ({
        entry: {
          id: r.id as string,
          content: r.content as string,
          source: (r.metadata as Record<string, unknown>)?.source as MemorySource || 'user',
          workspaceId: (r.metadata as Record<string, unknown>)?.workspaceId as string | undefined,
          metadata: (r.metadata as Record<string, unknown>) || {},
          createdAt: r.createdAt as string,
        },
        score: r.score as number
      }));
    } catch {
      console.error('[Memory] Failed to parse search results');
      return [];
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    // QMD doesn't have a direct get by ID, so we search with the ID
    const results = await this.search(id, { limit: 1 });
    const found = results.find(r => r.entry.id === id);
    return found?.entry || null;
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const result = await this.mcpClient!.callTool({
      name: 'qmd_forget',
      arguments: {
        query: id,
        limit: 1
      }
    });

    const text = this.extractTextContent(result.content);
    const deleted = parseInt(text || '0', 10);
    return deleted > 0;
  }

  async forget(query: string, limit?: number): Promise<number> {
    this.ensureInitialized();

    const result = await this.mcpClient!.callTool({
      name: 'qmd_forget',
      arguments: {
        query,
        limit: limit || 10
      }
    });

    const text = this.extractTextContent(result.content);
    return parseInt(text || '0', 10);
  }

  async reflect(): Promise<void> {
    this.ensureInitialized();

    await this.mcpClient!.callTool({
      name: 'qmd_reflect',
      arguments: {}
    });
  }

  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
      this.initialized = false;
      console.log('[Memory] Disconnected from QMD');
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.mcpClient) {
      throw new Error('Memory manager not initialized. Call initialize() first.');
    }
  }

  private extractTextContent(content: unknown): string {
    if (Array.isArray(content)) {
      const textBlock = content.find((c: Record<string, unknown>) => c.type === 'text');
      return (textBlock as Record<string, unknown>)?.text as string || '';
    }
    return '';
  }
}

/**
 * Create a memory manager instance
 */
export function createMemoryManager(config: MemoryConfig, dataDir: string): MemoryManager {
  return new MemoryManager(config, dataDir);
}
