/**
 * Memory Manager (Legacy)
 *
 * @deprecated Use HybridMemoryManager instead for better memory organization.
 *
 * This is a thin wrapper around QMD MCP server for searching indexed documents.
 * NOTE: QMD is a search engine for existing markdown files, not a key-value store.
 * - Use search() to find documents
 * - add() writes to a local markdown file that can be indexed by QMD
 *
 * For full memory capabilities (core memory, daily logs, semantic search),
 * use HybridMemoryManager from './hybrid-manager.js'.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MemoryEntry, MemorySearchResult, MemoryConfig, MemorySource } from '../types.js';
import path from 'path';
import fs from 'fs';

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
  private memoriesFile: string;
  private initialized: boolean = false;

  constructor(config: MemoryConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
    this.memoriesFile = path.join(dataDir, 'memories.md');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
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

  /**
   * Add a memory by appending to local markdown file
   * This file can be indexed by QMD via 'qmd collection add'
   */
  async add(content: string, options?: MemoryAddOptions): Promise<MemoryEntry> {
    const id = `mem-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const source = options?.source || 'user';

    const entry: MemoryEntry = {
      id,
      content,
      source,
      workspaceId: options?.workspaceId,
      metadata: options?.metadata,
      createdAt: timestamp,
    };

    // Append to markdown file for QMD indexing
    const lines = [
      `## ${id}`,
      `*${timestamp} | ${source}${options?.workspaceId ? ` | ${options.workspaceId}` : ''}*`,
      '',
      content,
      '',
      '---',
      '',
    ];

    fs.appendFileSync(this.memoriesFile, lines.join('\n'), 'utf-8');

    return entry;
  }

  /**
   * Search using QMD's vector_search tool
   */
  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    this.ensureInitialized();

    try {
      const result = await this.mcpClient!.callTool({
        name: 'vector_search',
        arguments: {
          query,
          limit: options?.limit || 10,
          minScore: 0.3,
        }
      });

      return this.parseSearchResults(result);
    } catch {
      // Fallback to keyword search if vector search fails
      try {
        const result = await this.mcpClient!.callTool({
          name: 'search',
          arguments: {
            query,
            limit: options?.limit || 10,
          }
        });
        return this.parseSearchResults(result);
      } catch (error) {
        console.error('[Memory] Search failed:', error);
        return [];
      }
    }
  }

  /**
   * Parse QMD search results into MemorySearchResult format
   */
  private parseSearchResults(result: { content: unknown }): MemorySearchResult[] {
    const content = result.content as Array<{ type: string; text: string }>;
    const textBlock = content?.find(c => c.type === 'text');
    if (!textBlock?.text) return [];

    // Try structured content first
    const structured = result as { structuredContent?: { results?: Array<{
      docid: string;
      file: string;
      title: string;
      score: number;
      snippet: string;
    }> } };

    if (structured.structuredContent?.results) {
      return structured.structuredContent.results.map(r => ({
        entry: {
          id: r.docid,
          content: r.snippet,
          source: 'user' as MemorySource,
          metadata: { file: r.file, title: r.title },
          createdAt: new Date().toISOString(),
        },
        score: r.score,
      }));
    }

    // Parse text response
    const results: MemorySearchResult[] = [];
    const lines = textBlock.text.split('\n').filter(l => l.trim());

    for (const line of lines.slice(1)) {
      const match = line.match(/^#(\w+)\s+(\d+)%\s+(.+)\s+-\s+(.+)$/);
      if (match) {
        results.push({
          entry: {
            id: match[1],
            content: match[3],
            source: 'user' as MemorySource,
            metadata: { file: match[2], title: match[3] },
            createdAt: new Date().toISOString(),
          },
          score: parseInt(match[2], 10) / 100,
        });
      }
    }

    return results;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    // Use QMD's get tool to retrieve by docid
    try {
      const result = await this.mcpClient!.callTool({
        name: 'get',
        arguments: {
          file: `#${id}`,
        }
      });

      const content = result.content as Array<{ type: string; resource?: { text: string } }>;
      const resourceBlock = content?.find(c => c.type === 'resource');
      if (resourceBlock?.resource?.text) {
        return {
          id,
          content: resourceBlock.resource.text,
          source: 'user',
          createdAt: new Date().toISOString(),
        };
      }
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Delete is not supported - QMD indexes files, not individual entries
   * To delete content, remove it from the source markdown file
   */
  async delete(_id: string): Promise<boolean> {
    console.warn('[Memory] Delete not supported by QMD - remove content from source file instead');
    return false;
  }

  /**
   * Forget is not supported - QMD indexes files, not individual entries
   */
  async forget(_query: string, _limit?: number): Promise<number> {
    console.warn('[Memory] Forget not supported by QMD - remove content from source file instead');
    return 0;
  }

  /**
   * Check QMD status instead of reflect (QMD doesn't have reflect)
   */
  async reflect(): Promise<void> {
    this.ensureInitialized();

    try {
      const result = await this.mcpClient!.callTool({
        name: 'status',
        arguments: {}
      });

      const content = result.content as Array<{ type: string; text: string }>;
      const textBlock = content?.find(c => c.type === 'text');
      if (textBlock?.text) {
        console.log('[Memory] QMD status:', textBlock.text.split('\n')[0]);
      }
    } catch (error) {
      console.error('[Memory] Status check failed:', error);
    }
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
}

/**
 * Create a memory manager instance
 * @deprecated Use createHybridMemoryManager instead
 */
export function createMemoryManager(config: MemoryConfig, dataDir: string): MemoryManager {
  return new MemoryManager(config, dataDir);
}
