/**
 * Ticket Manager
 *
 * Manages ticket CRUD operations and status tracking.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type {
  Ticket,
  TicketType,
  TicketStatus,
  TicketPriority,
  TicketAssignee,
  TicketComment,
  TicketAiContext,
} from '../types.js';

const SCHEMA = `
-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  forum_post_id TEXT,
  forum_channel_id TEXT,
  guild_id TEXT NOT NULL,

  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',

  assignee TEXT NOT NULL DEFAULT 'unassigned',
  assignee_user_id TEXT,

  title TEXT NOT NULL,
  description TEXT,

  created_by TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  related_session_ids TEXT DEFAULT '[]',
  linked_commit_shas TEXT DEFAULT '[]',
  linked_pr_urls TEXT DEFAULT '[]',

  ai_context TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee);
CREATE INDEX IF NOT EXISTS idx_tickets_forum_post ON tickets(forum_post_id);
CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);

-- Ticket comments
CREATE TABLE IF NOT EXISTS ticket_comments (
  comment_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  discord_message_id TEXT,
  author TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_ai_question INTEGER DEFAULT 0,
  is_status_update INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON ticket_comments(created_at);
`;

export interface CreateTicketOptions {
  title: string;
  description: string;
  type?: TicketType;
  priority?: TicketPriority;
  guildId: string;
  forumChannelId?: string;
  forumPostId?: string;
  createdBy: 'user' | 'ai';
  createdById: string;
}

export interface UpdateTicketOptions {
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: TicketAssignee;
  assigneeUserId?: string;
  title?: string;
  description?: string;
  aiContext?: TicketAiContext;
}

export interface TicketSearchOptions {
  status?: TicketStatus;
  type?: TicketType;
  assignee?: TicketAssignee;
  guildId?: string;
  limit?: number;
}

export class TicketManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Create a new ticket
   */
  create(options: CreateTicketOptions): Ticket {
    const now = new Date().toISOString();
    const ticketId = uuid();

    const stmt = this.db.prepare(`
      INSERT INTO tickets (
        ticket_id, forum_post_id, forum_channel_id, guild_id,
        type, status, priority, assignee,
        title, description, created_by, created_by_id,
        created_at, updated_at, related_session_ids, linked_commit_shas, linked_pr_urls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]')
    `);

    stmt.run(
      ticketId,
      options.forumPostId || null,
      options.forumChannelId || null,
      options.guildId,
      options.type || 'task',
      'open',
      options.priority || 'normal',
      'unassigned',
      options.title,
      options.description,
      options.createdBy,
      options.createdById,
      now,
      now
    );

    return this.get(ticketId)!;
  }

  /**
   * Get a ticket by ID
   */
  get(ticketId: string): Ticket | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId);
    return row ? this.rowToTicket(row as Record<string, unknown>) : null;
  }

  /**
   * Get a ticket by Discord forum post ID
   */
  getByForumPostId(forumPostId: string): Ticket | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE forum_post_id = ?').get(forumPostId);
    return row ? this.rowToTicket(row as Record<string, unknown>) : null;
  }

  /**
   * Update a ticket
   */
  update(ticketId: string, options: UpdateTicketOptions): Ticket | null {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (options.type !== undefined) {
      updates.push('type = ?');
      values.push(options.type);
    }
    if (options.status !== undefined) {
      updates.push('status = ?');
      values.push(options.status);
    }
    if (options.priority !== undefined) {
      updates.push('priority = ?');
      values.push(options.priority);
    }
    if (options.assignee !== undefined) {
      updates.push('assignee = ?');
      values.push(options.assignee);
    }
    if (options.assigneeUserId !== undefined) {
      updates.push('assignee_user_id = ?');
      values.push(options.assigneeUserId);
    }
    if (options.title !== undefined) {
      updates.push('title = ?');
      values.push(options.title);
    }
    if (options.description !== undefined) {
      updates.push('description = ?');
      values.push(options.description);
    }
    if (options.aiContext !== undefined) {
      updates.push('ai_context = ?');
      values.push(JSON.stringify(options.aiContext));
    }

    if (updates.length === 0) {
      return this.get(ticketId);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(ticketId);

    this.db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE ticket_id = ?`).run(...values);

    return this.get(ticketId);
  }

  /**
   * Search tickets
   */
  search(options: TicketSearchOptions = {}): Ticket[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }
    if (options.type) {
      conditions.push('type = ?');
      values.push(options.type);
    }
    if (options.assignee) {
      conditions.push('assignee = ?');
      values.push(options.assignee);
    }
    if (options.guildId) {
      conditions.push('guild_id = ?');
      values.push(options.guildId);
    }

    let sql = 'SELECT * FROM tickets';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...values) as Record<string, unknown>[];
    return rows.map(this.rowToTicket);
  }

  /**
   * Delete a ticket
   */
  delete(ticketId: string): boolean {
    const result = this.db.prepare('DELETE FROM tickets WHERE ticket_id = ?').run(ticketId);
    return result.changes > 0;
  }

  /**
   * Add a comment to a ticket
   */
  addComment(
    ticketId: string,
    content: string,
    author: 'user' | 'ai',
    authorId: string,
    options?: { discordMessageId?: string; isAiQuestion?: boolean; isStatusUpdate?: boolean }
  ): TicketComment {
    const commentId = uuid();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO ticket_comments (
        comment_id, ticket_id, discord_message_id, author, author_id, content, created_at, is_ai_question, is_status_update
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      commentId,
      ticketId,
      options?.discordMessageId || null,
      author,
      authorId,
      content,
      now,
      options?.isAiQuestion ? 1 : 0,
      options?.isStatusUpdate ? 1 : 0
    );

    // Update ticket's updated_at
    this.db.prepare('UPDATE tickets SET updated_at = ? WHERE ticket_id = ?').run(now, ticketId);

    return {
      commentId,
      ticketId,
      discordMessageId: options?.discordMessageId || undefined,
      author,
      authorId,
      content,
      createdAt: now,
      isAiQuestion: options?.isAiQuestion || false,
      isStatusUpdate: options?.isStatusUpdate || false,
    };
  }

  /**
   * Get comments for a ticket
   */
  getComments(ticketId: string): TicketComment[] {
    const rows = this.db.prepare(
      'SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC'
    ).all(ticketId) as Record<string, unknown>[];

    return rows.map((row) => ({
      commentId: row.comment_id as string,
      ticketId: row.ticket_id as string,
      discordMessageId: row.discord_message_id ? String(row.discord_message_id) : undefined,
      author: row.author as 'user' | 'ai',
      authorId: row.author_id as string,
      content: row.content as string,
      createdAt: row.created_at as string,
      isAiQuestion: row.is_ai_question === 1,
      isStatusUpdate: row.is_status_update === 1,
    }));
  }

  /**
   * Link a session to a ticket
   */
  linkSession(ticketId: string, sessionId: string): void {
    const ticket = this.get(ticketId);
    if (!ticket) return;

    const sessions = [...ticket.relatedSessionIds];
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId);
      this.db.prepare('UPDATE tickets SET related_session_ids = ? WHERE ticket_id = ?').run(
        JSON.stringify(sessions),
        ticketId
      );
    }
  }

  /**
   * Link a commit to a ticket
   */
  linkCommit(ticketId: string, commitSha: string): void {
    const ticket = this.get(ticketId);
    if (!ticket) return;

    const commits = [...ticket.linkedCommitShas];
    if (!commits.includes(commitSha)) {
      commits.push(commitSha);
      this.db.prepare('UPDATE tickets SET linked_commit_shas = ? WHERE ticket_id = ?').run(
        JSON.stringify(commits),
        ticketId
      );
    }
  }

  /**
   * Link a PR to a ticket
   */
  linkPR(ticketId: string, prUrl: string): void {
    const ticket = this.get(ticketId);
    if (!ticket) return;

    const prs = [...ticket.linkedPrUrls];
    if (!prs.includes(prUrl)) {
      prs.push(prUrl);
      this.db.prepare('UPDATE tickets SET linked_pr_urls = ? WHERE ticket_id = ?').run(
        JSON.stringify(prs),
        ticketId
      );
    }
  }

  /**
   * Get statistics
   */
  getStats(guildId?: string): {
    total: number;
    byStatus: Record<TicketStatus, number>;
    byType: Record<TicketType, number>;
    byAssignee: Record<TicketAssignee, number>;
  } {
    const guildCondition = guildId ? 'WHERE guild_id = ?' : '';
    const params = guildId ? [guildId] : [];

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM tickets ${guildCondition}`).get(...params) as { count: number };

    const byStatus: Record<TicketStatus, number> = {
      open: 0, triage: 0, in_progress: 0, blocked: 0, review: 0, done: 0, wontfix: 0, duplicate: 0,
    };
    const byType: Record<TicketType, number> = { bug: 0, feature: 0, question: 0, task: 0 };
    const byAssignee: Record<TicketAssignee, number> = { unassigned: 0, ai: 0, user: 0 };

    const statusRows = this.db.prepare(`SELECT status, COUNT(*) as count FROM tickets ${guildCondition} GROUP BY status`).all(...params) as { status: TicketStatus; count: number }[];
    for (const row of statusRows) {
      byStatus[row.status] = row.count;
    }

    const typeRows = this.db.prepare(`SELECT type, COUNT(*) as count FROM tickets ${guildCondition} GROUP BY type`).all(...params) as { type: TicketType; count: number }[];
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    const assigneeRows = this.db.prepare(`SELECT assignee, COUNT(*) as count FROM tickets ${guildCondition} GROUP BY assignee`).all(...params) as { assignee: TicketAssignee; count: number }[];
    for (const row of assigneeRows) {
      byAssignee[row.assignee] = row.count;
    }

    return { total: total.count, byStatus, byType, byAssignee };
  }

  /**
   * Close the database
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert database row to Ticket
   */
  private rowToTicket(row: Record<string, unknown>): Ticket {
    return {
      ticketId: row.ticket_id as string,
      forumPostId: row.forum_post_id ? String(row.forum_post_id) : undefined,
      forumChannelId: row.forum_channel_id ? String(row.forum_channel_id) : undefined,
      guildId: row.guild_id as string,
      type: row.type as TicketType,
      status: row.status as TicketStatus,
      priority: row.priority as TicketPriority,
      assignee: row.assignee as TicketAssignee,
      assigneeUserId: row.assignee_user_id ? String(row.assignee_user_id) : undefined,
      title: row.title as string,
      description: row.description as string,
      createdBy: row.created_by as 'user' | 'ai',
      createdById: row.created_by_id as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      relatedSessionIds: JSON.parse(row.related_session_ids as string || '[]'),
      linkedCommitShas: JSON.parse(row.linked_commit_shas as string || '[]'),
      linkedPrUrls: JSON.parse(row.linked_pr_urls as string || '[]'),
      aiContext: row.ai_context ? JSON.parse(row.ai_context as string) : undefined,
    };
  }
}

/**
 * Create a ticket manager instance
 */
export function createTicketManager(dbPath: string): TicketManager {
  return new TicketManager(dbPath);
}
