/**
 * Hybrid Memory Manager
 *
 * Unified memory system combining:
 * - Core Memory: Long-term curated facts, preferences, decisions
 * - Daily Logs: Day-based work summaries and activity
 *
 * For semantic search, install QMD and add the memory directory:
 *   qmd collection add ~/.squire/memory --name squire
 *   qmd embed
 *
 * The AI can then use QMD's MCP tools (qmd_search, qmd_vector_search) directly.
 */

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

/**
 * Context to inject into AI prompts
 */
export interface MemoryContext {
  coreMemory: string;           // Overview of core memories
  recentLogs: string;           // Yesterday + today's logs
  activeProjects: string[];     // Recently active projects
}

export class HybridMemoryManager {
  private memoryDir: string;

  // Sub-managers
  private coreMemory: CoreMemoryManager;
  private dailyLog: DailyLogManager;
  private initialized: boolean = false;

  constructor(options: HybridMemoryOptions) {
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

    this.initialized = true;
    console.log('[Memory] Memory system initialized');
  }

  /**
   * Get the memory directory path (for QMD indexing)
   */
  getMemoryDir(): string {
    return this.memoryDir;
  }

  /**
   * Get intelligent context for AI prompts
   * Returns: core memory overview + yesterday + today's logs
   */
  async getContext(): Promise<MemoryContext> {
    this.ensureInitialized();

    // Get core memory overview
    const coreMemory = this.coreMemory.getOverview();

    // Get yesterday and today's logs
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const todayLog = await this.dailyLog.loadLog(today);
    const yesterdayLog = await this.dailyLog.loadLog(yesterday);

    const recentParts: string[] = [];

    if (yesterdayLog.entries.length > 0) {
      recentParts.push(`**Yesterday (${yesterday}):**`);
      for (const entry of yesterdayLog.entries.slice(0, 10)) {
        recentParts.push(`- ${this.formatEntryForContext(entry)}`);
      }
    }

    if (todayLog.entries.length > 0) {
      recentParts.push(`\n**Today (${today}):**`);
      for (const entry of todayLog.entries.slice(0, 10)) {
        recentParts.push(`- ${this.formatEntryForContext(entry)}`);
      }
    }

    const recentLogs = recentParts.join('\n') || 'No recent activity.';

    // Get active projects
    const recentActivity = await this.dailyLog.getRecentActivity(7);
    const activeProjects = recentActivity.activeWorkspaces;

    return {
      coreMemory,
      recentLogs,
      activeProjects,
    };
  }

  /**
   * Format a daily log entry for context display
   */
  private formatEntryForContext(entry: DailyLogEntry): string {
    switch (entry.type) {
      case 'commit':
        const sha = entry.metadata?.commitSha?.slice(0, 7) || '???';
        return `Commit: ${sha} ${entry.metadata?.commitMessage || entry.content}`;
      case 'task':
        const status = entry.metadata?.taskStatus;
        const icon = status === 'completed' ? '✓' : status === 'blocked' ? '⚠' : '→';
        return `${icon} Task: ${entry.metadata?.taskName || entry.content}`;
      case 'learning':
        return `💡 Learned: ${entry.content}`;
      case 'decision':
        return `Decision: ${entry.content.split('\n')[0]}`;
      default:
        return entry.content;
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
  ): Promise<MemoryEntry> {
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
   * Search local memory (core + recent daily logs)
   * For full semantic search, use QMD's MCP tools directly
   */
  async search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<LegacyMemorySearchResult[]> {
    this.ensureInitialized();

    const results: LegacyMemorySearchResult[] = [];
    const limit = options?.limit || 10;

    // Search core memory (local keyword match)
    const coreResults = this.coreMemory.search(query);
    for (const entry of coreResults.slice(0, limit)) {
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

    // Search recent daily logs (local)
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    for (const date of [today, yesterday]) {
      const log = await this.dailyLog.loadLog(date);
      const lowerQuery = query.toLowerCase();

      for (const entry of log.entries) {
        if (entry.content.toLowerCase().includes(lowerQuery)) {
          const legacyEntry: MemoryEntry = {
            id: entry.id,
            content: entry.content,
            source: 'user' as MemorySource,
            workspaceId: entry.workspaceId,
            metadata: { type: entry.type, date },
            createdAt: entry.timestamp,
          };
          results.push({
            entry: legacyEntry,
            score: 0.8,
          });
        }
      }
    }

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
    this.ensureInitialized();

    const results: MemorySearchResult[] = [];
    const limit = options?.limit || 10;

    // Search core memory
    const coreResults = this.coreMemory.search(query);
    for (const entry of coreResults.slice(0, limit)) {
      results.push({
        entry,
        score: 1.0,
        source: 'core',
        citation: `MEMORY.md > ${entry.type}`,
      });
    }

    // Search recent daily logs
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    for (const date of [today, yesterday]) {
      const log = await this.dailyLog.loadLog(date);
      const lowerQuery = query.toLowerCase();

      for (const entry of log.entries) {
        if (entry.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            entry,
            score: 0.8,
            source: 'daily',
            citation: `daily/${date}.md`,
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    this.ensureInitialized();

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
        totalDays: 0,
        totalEntries: 0,
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
    this.ensureInitialized();

    const stats = await this.getStats();
    const recentActivity = await this.dailyLog.getRecentActivity(7);

    return {
      stats,
      recentHighlights: recentActivity.highlights,
      recentWork: [],
      activeProjects: recentActivity.activeWorkspaces,
      lastActive: new Date().toISOString(),
    };
  }

  /**
   * Close connections (no-op, kept for compatibility)
   */
  async close(): Promise<void> {
    this.initialized = false;
    console.log('[Memory] Closed');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Memory manager not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create a hybrid memory manager
 */
export function createHybridMemoryManager(options: HybridMemoryOptions): HybridMemoryManager {
  return new HybridMemoryManager(options);
}
