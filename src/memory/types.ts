/**
 * Memory Types
 *
 * Structured memory system with daily logs and core memory.
 * Inspired by OpenClaw's hybrid Markdown + semantic search approach.
 */

// Import shared types
import type { MemorySource } from '../types.js';

// Re-export for convenience
export type { MemorySource } from '../types.js';

// ============================================================================
// Core Memory - Long-term curated facts, preferences, decisions
// ============================================================================

/**
 * Types of core memory entries
 */
export type CoreMemoryType =
  | 'preference'    // User preferences (I prefer TypeScript, dark mode, etc.)
  | 'fact'          // Objective facts (User works at X, lives in Y)
  | 'decision'      // Past decisions with context (Why we chose library X)
  | 'pattern'       // Observed patterns (User codes late at night)
  | 'skill'         // Learned skills (User knows React, Python)
  | 'contact'       // Important contacts (John is the API owner)
  | 'project';      // Project knowledge (DisCode uses WebSocket for sync)

/**
 * A curated long-term memory entry
 */
export interface CoreMemoryEntry {
  id: string;
  type: CoreMemoryType;
  content: string;
  confidence: number;       // 0-1, how confident we are
  source: MemorySource;
  workspaceId?: string;     // If specific to a workspace
  tags: string[];           // For categorization
  evidence?: string;        // Why we believe this
  createdAt: string;
  updatedAt: string;
  lastReferenced?: string;  // When this was last used
  referenceCount: number;   // How often referenced
}

/**
 * Core memory section structure
 */
export interface CoreMemorySection {
  type: CoreMemoryType;
  title: string;
  description: string;
  entries: CoreMemoryEntry[];
}

// ============================================================================
// Daily Log - Day-based work summaries and events
// ============================================================================

/**
 * Types of daily log entries
 */
export type DailyLogEntryType =
  | 'summary'       // End-of-day summary
  | 'commit'        // Git commit made
  | 'task'          // Task completed/started
  | 'discussion'    // Key discussion points
  | 'decision'      // Decision made today
  | 'blocker'       // Something blocking progress
  | 'learning'      // Something learned
  | 'note';         // General note

/**
 * A single entry in the daily log
 */
export interface DailyLogEntry {
  id: string;
  type: DailyLogEntryType;
  timestamp: string;
  content: string;
  workspaceId?: string;
  metadata?: {
    commitSha?: string;
    commitMessage?: string;
    filesChanged?: string[];
    taskName?: string;
    taskStatus?: 'started' | 'completed' | 'blocked';
    project?: string;
  };
}

/**
 * A full day's log
 */
export interface DailyLog {
  date: string;              // YYYY-MM-DD format
  entries: DailyLogEntry[];
  summary?: string;          // AI-generated end-of-day summary
  highlights: string[];      // Key points from the day
  workspaces: string[];      // Workspaces active this day
  commits: number;           // Total commits
  tasksCompleted: number;    // Tasks completed
}

// ============================================================================
// Memory Search & Query
// ============================================================================

/**
 * Result from memory search
 */
export interface MemorySearchResult {
  entry: CoreMemoryEntry | DailyLogEntry;
  score: number;
  source: 'core' | 'daily';
  citation: string;          // Human-readable citation
  context?: string;          // Surrounding context
}

/**
 * Options for searching memory
 */
export interface MemorySearchOptions {
  limit?: number;
  minScore?: number;
  types?: CoreMemoryType[];
  workspaceId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  includeCore?: boolean;
  includeDaily?: boolean;
}

/**
 * Options for adding memory
 */
export interface MemoryAddOptions {
  type?: CoreMemoryType;
  source?: MemorySource;
  workspaceId?: string;
  tags?: string[];
  confidence?: number;
  evidence?: string;
}

// ============================================================================
// Memory Stats & Overview
// ============================================================================

/**
 * Memory statistics
 */
export interface MemoryStats {
  coreMemory: {
    totalEntries: number;
    byType: Record<CoreMemoryType, number>;
    oldestEntry: string;
    newestEntry: string;
    mostReferenced: CoreMemoryEntry | null;
  };
  dailyLogs: {
    totalDays: number;
    totalEntries: number;
    oldestLog: string;
    newestLog: string;
    commitsThisWeek: number;
    tasksCompletedThisWeek: number;
  };
}

/**
 * Memory overview for display
 */
export interface MemoryOverview {
  stats: MemoryStats;
  recentHighlights: string[];
  recentWork: string[];
  activeProjects: string[];
  lastActive: string;
}

// ============================================================================
// Re-export existing types
// ============================================================================

export interface MemoryEntry {
  id: string;
  content: string;
  source: MemorySource;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
