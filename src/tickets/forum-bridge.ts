/**
 * Forum Bridge
 *
 * Connects ticket manager to Discord forum channels.
 * Maps forum posts to tickets and vice versa.
 */

import type { Ticket, TicketType, TicketStatus, TicketPriority, TicketAssignee } from '../types.js';
import type { TicketManager, CreateTicketOptions } from './manager.js';

// Tag mappings for Discord forum tags
export const DEFAULT_TAG_MAPPINGS = {
  types: {
    bug: '🐛 Bug',
    feature: '✨ Feature',
    question: '❓ Question',
    task: '📋 Task',
  },
  priorities: {
    low: 'Priority: Low',
    normal: 'Priority: Normal',
    high: 'Priority: High',
    urgent: 'Priority: Urgent',
  },
  statuses: {
    open: 'Status: Open',
    triage: 'Status: Triage',
    in_progress: 'Status: In Progress',
    blocked: 'Status: Blocked',
    review: 'Status: Review',
    done: 'Status: Done',
    wontfix: 'Status: WontFix',
    duplicate: 'Status: Duplicate',
  },
  assignees: {
    unassigned: 'Unassigned',
    ai: 'Assigned: AI',
    user: 'Assigned: User',
  },
};

export interface ForumBridgeOptions {
  ticketManager: TicketManager;
  sendForumPost?: (options: CreateForumPostOptions) => Promise<{ postId: string; channelId: string }>;
  sendForumReply?: (postId: string, content: string) => Promise<void>;
  updateForumTags?: (postId: string, tags: string[]) => Promise<void>;
  tagMappings?: typeof DEFAULT_TAG_MAPPINGS;
}

export interface CreateForumPostOptions {
  forumChannelId: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface ForumPostEvent {
  type: 'forum_post_created' | 'forum_post_replied';
  guildId: string;
  forumChannelId: string;
  postId: string;
  title?: string;
  content?: string;
  authorId: string;
  authorName: string;
  appliedTags?: string[];
  replyId?: string;
  timestamp: string;
}

export class ForumBridge {
  private ticketManager: TicketManager;
  private sendForumPost?: ForumBridgeOptions['sendForumPost'];
  private sendForumReply?: ForumBridgeOptions['sendForumReply'];
  private updateForumTags?: ForumBridgeOptions['updateForumTags'];
  private tagMappings: typeof DEFAULT_TAG_MAPPINGS;
  private watchedChannels: Set<string> = new Set();

  constructor(options: ForumBridgeOptions) {
    this.ticketManager = options.ticketManager;
    this.sendForumPost = options.sendForumPost;
    this.sendForumReply = options.sendForumReply;
    this.updateForumTags = options.updateForumTags;
    this.tagMappings = options.tagMappings || DEFAULT_TAG_MAPPINGS;
  }

  /**
   * Watch a forum channel for ticket events
   */
  watchChannel(forumChannelId: string): void {
    this.watchedChannels.add(forumChannelId);
  }

  /**
   * Stop watching a forum channel
   */
  unwatchChannel(forumChannelId: string): void {
    this.watchedChannels.delete(forumChannelId);
  }

  /**
   * Check if a channel is being watched
   */
  isWatching(forumChannelId: string): boolean {
    return this.watchedChannels.has(forumChannelId);
  }

  /**
   * Handle a forum post event
   */
  async handleForumEvent(event: ForumPostEvent): Promise<Ticket | null> {
    if (!this.isWatching(event.forumChannelId)) {
      return null;
    }

    switch (event.type) {
      case 'forum_post_created':
        return this.handlePostCreated(event);

      case 'forum_post_replied':
        return this.handlePostReplied(event);

      default:
        return null;
    }
  }

  /**
   * Create a ticket from a forum post
   */
  createTicketFromPost(event: ForumPostEvent, createdBy: 'user' | 'ai'): Ticket {
    // Parse type and priority from tags
    const { type, priority } = this.parseTags(event.appliedTags || []);

    const ticket = this.ticketManager.create({
      title: event.title || 'Untitled',
      description: event.content || '',
      type,
      priority,
      guildId: event.guildId,
      forumChannelId: event.forumChannelId,
      forumPostId: event.postId,
      createdBy,
      createdById: event.authorId,
    });

    console.log(`[ForumBridge] Created ticket ${ticket.ticketId} from post ${event.postId}`);
    return ticket;
  }

  /**
   * Create a forum post from a ticket
   */
  async createPostFromTicket(
    ticket: Ticket,
    forumChannelId: string,
    authorId: string
  ): Promise<Ticket | null> {
    if (!this.sendForumPost) {
      console.warn('[ForumBridge] No sendForumPost handler configured');
      return null;
    }

    const tags = this.buildTags(ticket.type, ticket.priority, ticket.status, ticket.assignee);

    const { postId } = await this.sendForumPost({
      forumChannelId,
      title: ticket.title,
      content: ticket.description,
      tags,
    });

    const updated = this.ticketManager.update(ticket.ticketId, {
      forumPostId: postId,
    });

    console.log(`[ForumBridge] Created forum post ${postId} for ticket ${ticket.ticketId}`);
    return updated;
  }

  /**
   * Update ticket status and sync to forum
   */
  async updateStatus(ticketId: string, status: TicketStatus): Promise<Ticket | null> {
    const ticket = this.ticketManager.update(ticketId, { status });

    if (ticket?.forumPostId && this.updateForumTags) {
      const tags = this.buildTags(ticket.type, ticket.priority, ticket.status, ticket.assignee);
      await this.updateForumTags(ticket.forumPostId, tags);
    }

    return ticket;
  }

  /**
   * Assign ticket and sync to forum
   */
  async assignTicket(
    ticketId: string,
    assignee: TicketAssignee,
    userId?: string
  ): Promise<Ticket | null> {
    const ticket = this.ticketManager.update(ticketId, {
      assignee,
      assigneeUserId: userId,
    });

    if (ticket?.forumPostId && this.updateForumTags) {
      const tags = this.buildTags(ticket.type, ticket.priority, ticket.status, ticket.assignee);
      await this.updateForumTags(ticket.forumPostId, tags);
    }

    return ticket;
  }

  /**
   * Post a reply to a ticket's forum thread
   */
  async postReply(ticketId: string, content: string): Promise<void> {
    const ticket = this.ticketManager.get(ticketId);

    if (!ticket?.forumPostId) {
      console.warn(`[ForumBridge] Ticket ${ticketId} has no forum post`);
      return;
    }

    if (!this.sendForumReply) {
      console.warn('[ForumBridge] No sendForumReply handler configured');
      return;
    }

    await this.sendForumReply(ticket.forumPostId, content);

    // Add comment to ticket
    this.ticketManager.addComment(ticketId, content, 'ai', 'squire', { isStatusUpdate: true });
  }

  /**
   * Get ticket by forum post ID
   */
  getTicketByPostId(forumPostId: string): Ticket | null {
    return this.ticketManager.getByForumPostId(forumPostId);
  }

  private handlePostCreated(event: ForumPostEvent): Ticket {
    // Check if ticket already exists
    const existing = this.ticketManager.getByForumPostId(event.postId);
    if (existing) {
      return existing;
    }

    // Create new ticket from post
    return this.createTicketFromPost(event, 'user');
  }

  private handlePostReplied(event: ForumPostEvent): Ticket | null {
    // Find ticket by post ID
    const ticket = this.ticketManager.getByForumPostId(event.postId);
    if (!ticket) {
      return null;
    }

    // Add comment to ticket
    this.ticketManager.addComment(ticket.ticketId, event.content || '', 'user', event.authorId, {
      discordMessageId: event.replyId,
    });

    return ticket;
  }

  private parseTags(tags: string[]): { type: TicketType; priority: TicketPriority } {
    let type: TicketType = 'task';
    let priority: TicketPriority = 'normal';

    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();

      if (lowerTag.includes('bug')) {
        type = 'bug';
      } else if (lowerTag.includes('feature')) {
        type = 'feature';
      } else if (lowerTag.includes('question')) {
        type = 'question';
      }

      if (lowerTag.includes('urgent') || lowerTag.includes('critical')) {
        priority = 'urgent';
      } else if (lowerTag.includes('high')) {
        priority = 'high';
      } else if (lowerTag.includes('low')) {
        priority = 'low';
      }
    }

    return { type, priority };
  }

  private buildTags(
    type: TicketType,
    priority: TicketPriority,
    status: TicketStatus,
    assignee: TicketAssignee
  ): string[] {
    const tags: string[] = [];

    tags.push(this.tagMappings.types[type]);
    tags.push(this.tagMappings.priorities[priority]);
    tags.push(this.tagMappings.statuses[status]);
    tags.push(this.tagMappings.assignees[assignee]);

    return tags;
  }
}

/**
 * Create a forum bridge instance
 */
export function createForumBridge(options: ForumBridgeOptions): ForumBridge {
  return new ForumBridge(options);
}
