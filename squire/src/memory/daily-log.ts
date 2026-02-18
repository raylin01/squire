/**
 * Daily Log Manager
 *
 * Manages day-based memory entries stored as Markdown files.
 * Each day has its own file (YYYY-MM-DD.md) with structured entries.
 * Uses QMD for semantic search across all daily logs.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { DailyLog, DailyLogEntry, DailyLogEntryType, MemorySource } from './types.js';

export interface DailyLogOptions {
  memoryDir: string;         // Base directory for memory files
  qmdEnabled?: boolean;      // Whether to use QMD for search
}

/**
 * Format for Markdown entries
 *
 * ## 2025-01-16
 *
 * ### Summary
 * End-of-day summary here...
 *
 * ### Commits
 * - `abc123` Fix login bug (workspace: discode)
 *
 * ### Tasks
 * - [x] Implement auth flow (workspace: squire)
 * - [ ] Add tests
 *
 * ### Notes
 * - Discussed architecture with user
 * - Learned about WebSocket reconnection patterns
 */

const DATE_REGEX = /^(\d{4}-\d{2}-\d{2})$/;
const ENTRY_TYPE_MARKERS: Record<DailyLogEntryType, string> = {
  summary: '### Summary',
  commit: '### Commits',
  task: '### Tasks',
  discussion: '### Discussions',
  decision: '### Decisions',
  blocker: '### Blockers',
  learning: '### Learnings',
  note: '### Notes',
};

export class DailyLogManager {
  private memoryDir: string;
  private dailyDir: string;
  private cache: Map<string, DailyLog> = new Map();

  constructor(options: DailyLogOptions) {
    this.memoryDir = options.memoryDir;
    this.dailyDir = path.join(this.memoryDir, 'daily');

    // Ensure directories exist
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!fs.existsSync(this.dailyDir)) {
      fs.mkdirSync(this.dailyDir, { recursive: true });
    }
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get the file path for a date
   */
  private getFilePath(date: string): string {
    return path.join(this.dailyDir, `${date}.md`);
  }

  /**
   * Add an entry to a daily log
   */
  async addEntry(
    type: DailyLogEntryType,
    content: string,
    options?: {
      workspaceId?: string;
      metadata?: DailyLogEntry['metadata'];
      date?: string;  // Override date (defaults to today)
    }
  ): Promise<DailyLogEntry> {
    const date = options?.date || this.getToday();
    const entry: DailyLogEntry = {
      id: uuid(),
      type,
      timestamp: new Date().toISOString(),
      content,
      workspaceId: options?.workspaceId,
      metadata: options?.metadata,
    };

    // Load or create the daily log
    const log = await this.loadLog(date);

    // Add entry
    log.entries.push(entry);

    // Update workspace list
    if (options?.workspaceId && !log.workspaces.includes(options.workspaceId)) {
      log.workspaces.push(options.workspaceId);
    }

    // Update counters
    if (type === 'commit') {
      log.commits++;
    } else if (type === 'task' && options?.metadata?.taskStatus === 'completed') {
      log.tasksCompleted++;
    }

    // Save the log
    await this.saveLog(log);

    // Invalidate cache
    this.cache.delete(date);

    return entry;
  }

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
    return this.addEntry('commit', commitMessage, {
      workspaceId,
      metadata: {
        commitSha,
        commitMessage,
        filesChanged,
        project,
      },
    });
  }

  /**
   * Record a task
   */
  async recordTask(
    taskName: string,
    status: 'started' | 'completed' | 'blocked',
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    const content = status === 'completed'
      ? `Completed: ${taskName}`
      : status === 'blocked'
        ? `Blocked: ${taskName}`
        : `Started: ${taskName}`;

    return this.addEntry('task', content, {
      workspaceId,
      metadata: {
        taskName,
        taskStatus: status,
      },
    });
  }

  /**
   * Record a learning
   */
  async recordLearning(
    content: string,
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.addEntry('learning', content, { workspaceId });
  }

  /**
   * Record a decision
   */
  async recordDecision(
    decision: string,
    rationale: string,
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.addEntry('decision', `${decision}\n  Rationale: ${rationale}`, { workspaceId });
  }

  /**
   * Add a note
   */
  async addNote(
    content: string,
    workspaceId?: string
  ): Promise<DailyLogEntry> {
    return this.addEntry('note', content, { workspaceId });
  }

  /**
   * Generate end-of-day summary
   */
  async generateSummary(date?: string): Promise<string> {
    const targetDate = date || this.getToday();
    const log = await this.loadLog(targetDate);

    if (log.entries.length === 0) {
      return 'No activity recorded today.';
    }

    // Group entries by type
    const byType: Record<string, DailyLogEntry[]> = {};
    for (const entry of log.entries) {
      if (!byType[entry.type]) {
        byType[entry.type] = [];
      }
      byType[entry.type].push(entry);
    }

    // Build summary
    const parts: string[] = [`**${targetDate} Summary**`, ''];

    if (byType.commit && byType.commit.length > 0) {
      parts.push(`**Commits (${byType.commit.length}):**`);
      for (const c of byType.commit) {
        const sha = c.metadata?.commitSha?.slice(0, 7) || '???';
        parts.push(`  - \`${sha}\` ${c.metadata?.commitMessage || c.content}`);
      }
      parts.push('');
    }

    if (byType.task && byType.task.length > 0) {
      const completed = byType.task.filter(t => t.metadata?.taskStatus === 'completed');
      const started = byType.task.filter(t => t.metadata?.taskStatus === 'started');
      const blocked = byType.task.filter(t => t.metadata?.taskStatus === 'blocked');

      if (completed.length > 0) {
        parts.push(`**Tasks Completed (${completed.length}):**`);
        for (const t of completed) {
          parts.push(`  - ${t.metadata?.taskName || t.content}`);
        }
      }
      if (blocked.length > 0) {
        parts.push(`**Blocked (${blocked.length}):**`);
        for (const t of blocked) {
          parts.push(`  - ${t.metadata?.taskName || t.content}`);
        }
      }
      parts.push('');
    }

    if (byType.learning && byType.learning.length > 0) {
      parts.push(`**Learnings:**`);
      for (const l of byType.learning) {
        parts.push(`  - ${l.content}`);
      }
      parts.push('');
    }

    if (byType.decision && byType.decision.length > 0) {
      parts.push(`**Decisions:**`);
      for (const d of byType.decision) {
        parts.push(`  - ${d.content.split('\n')[0]}`);
      }
      parts.push('');
    }

    if (byType.note && byType.note.length > 0) {
      parts.push(`**Notes:**`);
      for (const n of byType.note) {
        parts.push(`  - ${n.content}`);
      }
    }

    const summary = parts.join('\n');

    // Save summary to log
    log.summary = summary;
    log.highlights = this.extractHighlights(byType);
    await this.saveLog(log);

    return summary;
  }

  /**
   * Extract key highlights from entries
   */
  private extractHighlights(byType: Record<string, DailyLogEntry[]>): string[] {
    const highlights: string[] = [];

    // Key commits
    if (byType.commit) {
      const keyCommits = byType.commit.slice(0, 3);
      for (const c of keyCommits) {
        highlights.push(`Commit: ${c.metadata?.commitMessage || c.content}`);
      }
    }

    // Key decisions
    if (byType.decision) {
      for (const d of byType.decision) {
        highlights.push(`Decision: ${d.content.split('\n')[0]}`);
      }
    }

    // Key learnings
    if (byType.learning) {
      for (const l of byType.learning) {
        highlights.push(`Learned: ${l.content}`);
      }
    }

    return highlights.slice(0, 5);  // Max 5 highlights
  }

  /**
   * Load a daily log (from cache or file)
   */
  async loadLog(date: string): Promise<DailyLog> {
    // Check cache
    if (this.cache.has(date)) {
      return this.cache.get(date)!;
    }

    const filePath = this.getFilePath(date);

    // Create new log if doesn't exist
    if (!fs.existsSync(filePath)) {
      const log: DailyLog = {
        date,
        entries: [],
        highlights: [],
        workspaces: [],
        commits: 0,
        tasksCompleted: 0,
      };
      this.cache.set(date, log);
      return log;
    }

    // Parse existing file
    const content = fs.readFileSync(filePath, 'utf-8');
    const log = this.parseMarkdown(content, date);
    this.cache.set(date, log);
    return log;
  }

  /**
   * Save a daily log to file
   */
  private async saveLog(log: DailyLog): Promise<void> {
    const content = this.toMarkdown(log);
    const filePath = this.getFilePath(log.date);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Convert log to Markdown
   */
  private toMarkdown(log: DailyLog): string {
    const lines: string[] = [];

    // Header
    lines.push(`# ${log.date}`, '');

    // Summary (if exists)
    if (log.summary) {
      lines.push('## Summary', '');
      lines.push(log.summary, '');
    }

    // Group entries by type
    const byType: Record<string, DailyLogEntry[]> = {};
    for (const entry of log.entries) {
      if (!byType[entry.type]) {
        byType[entry.type] = [];
      }
      byType[entry.type].push(entry);
    }

    // Write each type section
    for (const [type, entries] of Object.entries(byType)) {
      const marker = ENTRY_TYPE_MARKERS[type as DailyLogEntryType];
      if (!marker) continue;

      lines.push(marker, '');

      for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });

        switch (entry.type) {
          case 'commit':
            const sha = entry.metadata?.commitSha?.slice(0, 7) || '???';
            lines.push(`- \`${sha}\` ${entry.metadata?.commitMessage || entry.content} _[${time}]_`);
            break;

          case 'task':
            const status = entry.metadata?.taskStatus;
            const check = status === 'completed' ? 'x' : status === 'blocked' ? '!' : ' ';
            lines.push(`- [${check}] ${entry.metadata?.taskName || entry.content} _[${time}]_`);
            break;

          case 'discussion':
          case 'decision':
          case 'learning':
          case 'note':
            lines.push(`- ${entry.content} _[${time}]_`);
            break;

          default:
            lines.push(`- ${entry.content} _[${time}]_`);
        }
      }
      lines.push('');
    }

    // Metadata footer
    lines.push('---', '');
    lines.push(`_Workspaces: ${log.workspaces.join(', ') || 'none'}_`);
    lines.push(`_Commits: ${log.commits} | Tasks Completed: ${log.tasksCompleted}_`);

    return lines.join('\n');
  }

  /**
   * Parse Markdown to DailyLog
   */
  private parseMarkdown(content: string, date: string): DailyLog {
    const log: DailyLog = {
      date,
      entries: [],
      highlights: [],
      workspaces: [],
      commits: 0,
      tasksCompleted: 0,
    };

    const lines = content.split('\n');
    let currentType: DailyLogEntryType | null = null;

    for (const line of lines) {
      // Check for type headers
      for (const [type, marker] of Object.entries(ENTRY_TYPE_MARKERS)) {
        if (line.startsWith(marker)) {
          currentType = type as DailyLogEntryType;
          break;
        }
      }

      // Parse entries
      if (currentType && line.startsWith('- ')) {
        const entry = this.parseEntryLine(line, currentType);
        if (entry) {
          log.entries.push(entry);

          // Update counters
          if (entry.type === 'commit') {
            log.commits++;
          } else if (entry.type === 'task' && entry.metadata?.taskStatus === 'completed') {
            log.tasksCompleted++;
          }

          // Track workspaces
          if (entry.workspaceId && !log.workspaces.includes(entry.workspaceId)) {
            log.workspaces.push(entry.workspaceId);
          }
        }
      }
    }

    return log;
  }

  /**
   * Parse a single entry line
   */
  private parseEntryLine(line: string, type: DailyLogEntryType): DailyLogEntry | null {
    // Remove leading "- "
    let content = line.slice(2);

    // Extract timestamp
    const timeMatch = content.match(/_\[(\d{1,2}:\d{2})\]_$/);
    let timestamp = new Date().toISOString();
    if (timeMatch) {
      content = content.replace(/_\[\d{1,2}:\d{2}\]_$/, '').trim();
      // Use today's date with the extracted time
      const [hours, minutes] = timeMatch[1].split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      timestamp = date.toISOString();
    }

    const entry: DailyLogEntry = {
      id: uuid(),
      type,
      timestamp,
      content,
    };

    // Type-specific parsing
    if (type === 'commit') {
      const shaMatch = content.match(/`([a-f0-9]{7})`/);
      if (shaMatch) {
        entry.metadata = {
          commitSha: shaMatch[1],
          commitMessage: content.replace(/`[a-f0-9]{7}`\s*/, ''),
        };
      }
    } else if (type === 'task') {
      const checkMatch = content.match(/\[([x! ])\]/);
      if (checkMatch) {
        const status = checkMatch[1];
        entry.metadata = {
          taskName: content.replace(/\[[x! ]\]\s*/, ''),
          taskStatus: status === 'x' ? 'completed' : status === '!' ? 'blocked' : 'started',
        };
      }
    }

    return entry;
  }

  /**
   * Get logs for a date range
   */
  async getLogsInRange(startDate: string, endDate: string): Promise<DailyLog[]> {
    const logs: DailyLog[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const log = await this.loadLog(dateStr);
      if (log.entries.length > 0) {
        logs.push(log);
      }
    }

    return logs;
  }

  /**
   * Get recent activity summary
   */
  async getRecentActivity(days: number = 7): Promise<{
    totalCommits: number;
    totalTasks: number;
    activeWorkspaces: string[];
    highlights: string[];
  }> {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.getLogsInRange(
      startDate.toISOString().split('T')[0],
      today.toISOString().split('T')[0]
    );

    let totalCommits = 0;
    let totalTasks = 0;
    const activeWorkspaces = new Set<string>();
    const highlights: string[] = [];

    for (const log of logs) {
      totalCommits += log.commits;
      totalTasks += log.tasksCompleted;
      log.workspaces.forEach(w => activeWorkspaces.add(w));
      highlights.push(...log.highlights);
    }

    return {
      totalCommits,
      totalTasks,
      activeWorkspaces: Array.from(activeWorkspaces),
      highlights: highlights.slice(0, 10),
    };
  }

  /**
   * Get today's log
   */
  async getTodayLog(): Promise<DailyLog> {
    return this.loadLog(this.getToday());
  }

  /**
   * Get file paths for all daily logs (for QMD indexing)
   */
  getDailyLogPaths(): string[] {
    const files = fs.readdirSync(this.dailyDir);
    return files
      .filter(f => f.endsWith('.md') && DATE_REGEX.test(f.replace('.md', '')))
      .map(f => path.join(this.dailyDir, f));
  }
}

/**
 * Create a daily log manager
 */
export function createDailyLogManager(options: DailyLogOptions): DailyLogManager {
  return new DailyLogManager(options);
}
