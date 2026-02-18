/**
 * Hybrid Memory Manager
 *
 * Unified memory system combining:
 * - Core Memory: Long-term curated facts, preferences, decisions
 * - Daily Logs: Day-based work summaries and activity
 * - QMD: Semantic search across all memory
 *
 * Inspired by OpenClaw's hybrid Markdown + vector search approach.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import type { MemoryConfig, MemorySource, MemoryEntry, MemorySearchResult as LegacyMemorySearchResult } from '../types.js';
import type {
  MemorySearchResult,
  MemorySearchOptions,
  MemoryAddOptions,
  MemoryStats,
  MemoryOverview,
  CoreMemoryEntry,
  CoreMemoryType,
  DailyLogEntry,
  DailyLogEntryType,
} from './types.js';
import { CoreMemoryManager, createCoreMemoryManager } from './core-memory.js';
import { DailyLogManager, createDailyLogManager } from './daily-log.js';

export interface HybridMemoryOptions {
  config: MemoryConfig;
  dataDir: string;
  squireName: string;
}

export class HybridMemoryManager {
  private config: MemoryConfig;
  private memoryDir: string;

  // Sub-managers
  private coreMemory: CoreMemoryManager;
  private dailyLog: DailyLogManager;

  // QMD client for semantic search
  private mcpClient: Client | null = null;
  private initialized: boolean = false;

  constructor(options: HybridMemoryOptions) {
    this.config = options.config;
    this.memoryDir = path.join(options.dataDir, 'memory');

    // Initialize sub-managers
    this.coreMemory = createCoreMemoryManager({
      memoryDir: this.memoryDir,
      squireName: options.squireName,
    });

    this.dailyLog = createDailyLogManager({
      memoryDir: this.memoryDir,
    });
  }

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load core memory
    await this.coreMemory.load();
    console.log('[Memory] Core memory loaded');

    // Connect to QMD for semantic search
    if (this.config.enabled && this.config.provider === 'qmd') {
      await this.connectQMD();
    }

    this.initialized = true;
    console.log('[Memory] Hybrid memory initialized');
  }

  /**
   * Connect to QMD MCP server
   */
  private async connectQMD(): Promise<void> {
    try {
      const qmdPath = this.config.qmdPath || 'qmd';
      const qmdDataDir = this.config.dataDir || path.join(this.memoryDir, 'qmd');

      this.mcpClient = new Client(
        { name: 'squire-memory', version: '1.0.0' },
        { capabilities: {} }
      );

      const transport = new StdioClientTransport({
        command: qmdPath,
        args: ['mcp', '--data-dir', qmdDataDir]
      });

      await this.mcpClient.connect(transport);
      console.log('[Memory] Connected to QMD');
    } catch (error) {
      console.error('[Memory] Failed to connect to QMD:', error);
      this.mcpClient = null;
    }
  }

  // ==========================================================================
  // Core Memory Operations
  // ==========================================================================

  /**
   * Add a memory (backward compatible method)
   */
  async add(
    content: string,
    options?: MemoryAddOptions
  ): Promise<import('../types.js').MemoryEntry> {
    // Route to appropriate storage based on type
    const entry = await this.remember(content, options);

    // Return in legacy format
    return {
      id: entry.id,
      content: 'content' in entry ? entry.content : '',
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
      metadata: { type: 'type' in entry ? entry.type : 'note' },
      createdAt: 'timestamp' in entry ? entry.timestamp : entry.createdAt,
    };
  }

  /**
   * Record a preference
   */
  async recordPreference(
    preference: string,
    options?: { workspaceId?: string; evidence?: string }
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordPreference(preference, options);
  }

  /**
   * Record a fact
   */
  async recordFact(
    fact: string,
    options?: { workspaceId?: string; evidence?: string }
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordFact(fact, options);
  }

  /**
   * Record a decision
   */
  async recordDecision(
    decision: string,
    rationale: string,
    options?: { workspaceId?: string }
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordDecision(decision, rationale, options);
  }

  /**
   * Record a pattern
   */
  async recordPattern(
    pattern: string,
    options?: { workspaceId?: string; confidence?: number }
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordPattern(pattern, options);
  }

  /**
   * Record a skill
   */
  async recordSkill(
    skill: string,
    level?: 'beginner' | 'intermediate' | 'expert'
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordSkill(skill, level);
  }

  /**
   * Record project knowledge
   */
  async recordProjectKnowledge(
    project: string,
    knowledge: string,
    workspaceId?: string
  ): Promise<CoreMemoryEntry> {
    return this.coreMemory.recordProjectKnowledge(project, knowledge, workspaceId);
  }

  /**
   * Get core memory overview
   */
  getCoreMemoryOverview(): string {
    return this.coreMemory.getOverview();
  }

  /**
   * Get all core memories
   */
  getCoreMemories(): CoreMemoryEntry[] {
    return this.coreMemory.getAll();
  }

  // ==========================================================================
  // Daily Log Operations
  // ==========================================================================

  /**
   * Record a commit
   */
  async recordCommit(
    commitSha: string,
    commitMessage: string,
    filesChanged: string[],
    workspaceId?: string,
    project?: string
  ): Promise<DailyLogEntry> {
    return this.dailyLog.recordCommit(commitSha, commitMessage, filesChanged, workspaceId, project);
  }

  /**
   * Record a task
   */
  async recordTask(
    taskName: string,
    status: 'started' | 'completed' | 'blocked',
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.dailyLog.recordTask(taskName, status, workspaceId);
  }

  /**
   * Record a learning
   */
  async recordLearning(
    content: string,
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.dailyLog.recordLearning(content, workspaceId);
  }

  /**
   * Add a note to today's log
   */
  async addDailyNote(
    content: string,
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.dailyLog.addNote(content, workspaceId);
  }

  /**
   * Generate today's summary
   */
  async generateDailySummary(): Promise<string> {
    return this.dailyLog.generateSummary();
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(days?: number) {
    return this.dailyLog.getRecentActivity(days);
  }

  /**
   * Get today's log
   */
  async getTodayLog() {
    return this.dailyLog.getTodayLog();
  }

  // ==========================================================================
  // Unified Memory Operations
  // ==========================================================================

  /**
   * Remember something (smart routing to core or daily)
   */
  async remember(
    content: string,
    options?: MemoryAddOptions
  ): Promise<CoreMemoryEntry | DailyLogEntry> {
    const type = options?.type;

    // Route to appropriate storage
    if (type && ['preference', 'fact', 'decision', 'pattern', 'skill', 'contact', 'project'].includes(type)) {
      // Core memory types
      switch (type) {
        case 'preference':
          return this.recordPreference(content, options);
        case 'fact':
          return this.recordFact(content, options);
        case 'decision':
          return this.recordDecision(content, options?.evidence || '', options);
        case 'pattern':
          return this.recordPattern(content, options);
        case 'skill':
          return this.recordSkill(content);
        case 'project':
          return this.recordProjectKnowledge('general', content, options?.workspaceId);
        default:
          return this.recordFact(content, options);
      }
    }

    // Default: add as daily note
    return this.addDailyNote(content, options?.workspaceId);
  }

  /**
   * Search across all memory (QMD + local)
   * Returns results in legacy format for backward compatibility
   */
  async search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<LegacyMemorySearchResult[]> {
    const results: LegacyMemorySearchResult[] = [];
    const includeCore = options?.includeCore !== false;
    const includeDaily = options?.includeDaily !== false;
    const limit = options?.limit || 10;

    // Search core memory (local)
    if (includeCore) {
      const coreResults = this.coreMemory.search(query);
      for (const entry of coreResults.slice(0, limit)) {
        // Convert to legacy format
        const legacyEntry: MemoryEntry = {
          id: entry.id,
          content: entry.content,
          source: entry.source,
          workspaceId: entry.workspaceId,
          metadata: { type: entry.type, confidence: entry.confidence },
          createdAt: entry.createdAt,
        };
        results.push({
          entry: legacyEntry,
          score: 1.0,
        });
      }
    }

    // Search daily logs via QMD
    if (includeDaily && this.mcpClient) {
      try {
        const qmdResults = await this.searchQMD(query, limit);
        for (const r of qmdResults) {
          // Convert to legacy format
          const legacyEntry: MemoryEntry = {
            id: 'id' in r.entry ? (r.entry as { id: string }).id : `mem-${Date.now()}`,
            content: 'content' in r.entry ? (r.entry as { content: string }).content : '',
            source: 'user',
            metadata: { source: r.source, citation: r.citation },
            createdAt: 'timestamp' in r.entry ? (r.entry as { timestamp: string }).timestamp : new Date().toISOString(),
          };
          results.push({
            entry: legacyEntry,
            score: r.score,
          });
        }
      } catch (error) {
        console.error('[Memory] QMD search failed:', error);
      }
    }

    // Sort by score and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search with extended results (includes citation info)
   */
  async searchExtended(
    query: string,
    options?: MemorySearchOptions
  ): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    const includeCore = options?.includeCore !== false;
    const includeDaily = options?.includeDaily !== false;
    const limit = options?.limit || 10;

    // Search core memory (local)
    if (includeCore) {
      const coreResults = this.coreMemory.search(query);
      for (const entry of coreResults.slice(0, limit)) {
        results.push({
          entry,
          score: 1.0,
          source: 'core',
          citation: `MEMORY.md > ${entry.type}`,
        });
      }
    }

    // Search daily logs via QMD
    if (includeDaily && this.mcpClient) {
      try {
        const qmdResults = await this.searchQMD(query, limit);
        results.push(...qmdResults);
      } catch (error) {
        console.error('[Memory] QMD search failed:', error);
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search QMD using vector search for semantic matching
   */
  private async searchQMD(query: string, limit: number): Promise<MemorySearchResult[]> {
    if (!this.mcpClient) return [];

    try {
      // Use QMD's vector_search tool for semantic search
      const result = await this.mcpClient.callTool({
        name: 'vector_search',
        arguments: {
          query,
          limit,
          minScore: 0.3,
        }
      });

      // QMD returns structured content with results array
      const content = result.content as Array<{ type: string; text: string }>;
      const textBlock = content?.find(c => c.type === 'text');
      if (!textBlock?.text) return [];

      // Parse the structured content if available
      const structuredContent = result as { structuredContent?: { results?: Array<{
        docid: string;
        file: string;
        title: string;
        score: number;
        context: string | null;
        snippet: string;
      }> } };

      if (structuredContent.structuredContent?.results) {
        return structuredContent.structuredContent.results.map(r => ({
          entry: {
            id: r.docid,
            type: 'note' as DailyLogEntryType,
            timestamp: new Date().toISOString(),
            content: r.snippet,
          } as DailyLogEntry,
          score: r.score,
          source: 'daily' as const,
          citation: r.file,
        }));
      }

      // Fallback: parse text response
      const lines = textBlock.text.split('\n').filter(l => l.trim());
      const results: MemorySearchResult[] = [];

      for (const line of lines.slice(1)) { // Skip header line
        const match = line.match(/^#\w+\s+(\d+)%\s+(.+)\s+-\s+(.+)$/);
        if (match) {
          results.push({
            entry: {
              id: match[1],
              type: 'note' as DailyLogEntryType,
              timestamp: new Date().toISOString(),
              content: match[3],
            } as DailyLogEntry,
            score: parseInt(match[1], 10) / 100,
            source: 'daily' as const,
            citation: match[2],
          });
        }
      }

      return results.slice(0, limit);
    } catch (error) {
      console.error('[Memory] QMD search error:', error);
      return [];
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const coreEntries = this.coreMemory.getAll();
    const recentActivity = await this.dailyLog.getRecentActivity(7);

    // Count by type
    const byType: Record<CoreMemoryType, number> = {
      preference: 0,
      fact: 0,
      decision: 0,
      pattern: 0,
      skill: 0,
      contact: 0,
      project: 0,
    };
    for (const entry of coreEntries) {
      byType[entry.type]++;
    }

    // Get oldest/newest
    const sorted = [...coreEntries].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Get most referenced
    const mostReferenced = [...coreEntries]
      .sort((a, b) => b.referenceCount - a.referenceCount)[0] || null;

    return {
      coreMemory: {
        totalEntries: coreEntries.length,
        byType,
        oldestEntry: sorted[0]?.createdAt || '',
        newestEntry: sorted[sorted.length - 1]?.createdAt || '',
        mostReferenced,
      },
      dailyLogs: {
        totalDays: 0, // Would need to count files
        totalEntries: 0, // Would need to sum all logs
        oldestLog: '',
        newestLog: new Date().toISOString().split('T')[0],
        commitsThisWeek: recentActivity.totalCommits,
        tasksCompletedThisWeek: recentActivity.totalTasks,
      },
    };
  }

  /**
   * Get memory overview for display
   */
  async getOverview(): Promise<MemoryOverview> {
    const stats = await this.getStats();
    const recentActivity = await this.dailyLog.getRecentActivity(7);

    return {
      stats,
      recentHighlights: recentActivity.highlights,
      recentWork: [], // Would extract from recent logs
      activeProjects: recentActivity.activeWorkspaces,
      lastActive: new Date().toISOString(),
    };
  }

  /**
   * Get QMD status (reflection is not supported by QMD)
   * QMD indexes existing markdown files - use 'qmd embed' CLI to update embeddings
   */
  async reflect(): Promise<void> {
    if (this.mcpClient) {
      try {
        // Check QMD status instead of reflect (which doesn't exist)
        const result = await this.mcpClient.callTool({
          name: 'status',
          arguments: {}
        });
        console.log('[Memory] QMD status checked');
        // Log if embeddings need updating
        const content = result.content as Array<{ type: string; text: string }>;
        const textBlock = content?.find(c => c.type === 'text');
        if (textBlock?.text?.includes('Needs embedding:')) {
          const match = textBlock.text.match(/Needs embedding: (\d+)/);
          if (match && parseInt(match[1], 10) > 0) {
            console.log(`[Memory] ${match[1]} documents need embedding - run 'qmd embed' to update`);
          }
        }
      } catch (error) {
        console.error('[Memory] Status check failed:', error);
      }
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
    }
    this.initialized = false;
    console.log('[Memory] Closed');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Extract text from MCP content
   */
  private extractTextContent(content: unknown): string {
    if (Array.isArray(content)) {
      const textBlock = content.find((c: Record<string, unknown>) => c.type === 'text');
      return (textBlock as Record<string, unknown>)?.text as string || '';
    }
    return '';
  }
}

/**
 * Create a hybrid memory manager
 */
export function createHybridMemoryManager(options: HybridMemoryOptions): HybridMemoryManager {
  return new HybridMemoryManager(options);
}
