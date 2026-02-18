import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForumBridge, createForumBridge, ForumPostEvent } from './forum-bridge.js';
import { TicketManager } from './manager.js';
import type { Ticket, TicketType, TicketPriority } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ForumBridge', () => {
  let bridge: ForumBridge;
  let ticketManager: TicketManager;
  let tempDir: string;
  let dbPath: string;

  const mockSendForumPost = vi.fn();
  const mockSendForumReply = vi.fn();
  const mockUpdateForumTags = vi.fn();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));
    dbPath = path.join(tempDir, 'test.db');
    ticketManager = new TicketManager(dbPath);

    mockSendForumPost.mockReset();
    mockSendForumReply.mockReset();
    mockUpdateForumTags.mockReset();

    mockSendForumPost.mockResolvedValue({ postId: 'post-123', channelId: 'channel-456' });

    bridge = new ForumBridge({
      ticketManager,
      sendForumPost: mockSendForumPost,
      sendForumReply: mockSendForumReply,
      updateForumTags: mockUpdateForumTags,
    });
  });

  afterEach(() => {
    ticketManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('watchChannel', () => {
    it('should watch a forum channel', () => {
      bridge.watchChannel('channel-1');
      expect(bridge.isWatching('channel-1')).toBe(true);
    });

    it('should unwatch a forum channel', () => {
      bridge.watchChannel('channel-1');
      bridge.unwatchChannel('channel-1');
      expect(bridge.isWatching('channel-1')).toBe(false);
    });
  });

  describe('handleForumEvent', () => {
    beforeEach(() => {
      bridge.watchChannel('forum-channel-1');
    });

    it('should ignore events from non-watched channels', async () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'other-channel',
        postId: 'post-1',
        title: 'Test',
        content: 'Content',
        authorId: 'user-1',
        authorName: 'User',
        timestamp: new Date().toISOString(),
      };

      const result = await bridge.handleForumEvent(event);
      expect(result).toBeNull();
    });

    it('should create ticket from forum post', async () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'forum-channel-1',
        postId: 'post-1',
        title: 'Bug Report',
        content: 'Something is broken',
        authorId: 'user-1',
        authorName: 'User',
        appliedTags: ['Bug', 'Priority: High'],
        timestamp: new Date().toISOString(),
      };

      const result = await bridge.handleForumEvent(event);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Bug Report');
      expect(result?.forumPostId).toBe('post-1');
      expect(result?.type).toBe('bug');
    });

    it('should add comment on forum reply', async () => {
      // First create a ticket
      const ticket = ticketManager.create({
        title: 'Existing ticket',
        description: 'Test',
        guildId: 'guild-1',
        forumChannelId: 'forum-channel-1',
        forumPostId: 'post-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const event: ForumPostEvent = {
        type: 'forum_post_replied',
        guildId: 'guild-1',
        forumChannelId: 'forum-channel-1',
        postId: 'post-1',
        content: 'This is a reply',
        authorId: 'user-2',
        authorName: 'Another User',
        replyId: 'reply-1',
        timestamp: new Date().toISOString(),
      };

      await bridge.handleForumEvent(event);

      const comments = ticketManager.getComments(ticket.ticketId);
      expect(comments.length).toBe(1);
      expect(comments[0].content).toBe('This is a reply');
    });

    it('should not create duplicate tickets for same post', async () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'forum-channel-1',
        postId: 'post-1',
        title: 'Bug Report',
        content: 'Something is broken',
        authorId: 'user-1',
        authorName: 'User',
        timestamp: new Date().toISOString(),
      };

      const result1 = await bridge.handleForumEvent(event);
      const result2 = await bridge.handleForumEvent(event);

      expect(result1?.ticketId).toBe(result2?.ticketId);
    });
  });

  describe('createTicketFromPost', () => {
    it('should parse bug tag', () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        postId: 'post-1',
        title: 'Test',
        content: 'Content',
        authorId: 'user-1',
        authorName: 'User',
        appliedTags: ['Bug'],
        timestamp: new Date().toISOString(),
      };

      const ticket = bridge.createTicketFromPost(event, 'user');
      expect(ticket.type).toBe('bug');
    });

    it('should parse feature tag', () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        postId: 'post-1',
        title: 'Test',
        content: 'Content',
        authorId: 'user-1',
        authorName: 'User',
        appliedTags: ['Feature Request'],
        timestamp: new Date().toISOString(),
      };

      const ticket = bridge.createTicketFromPost(event, 'user');
      expect(ticket.type).toBe('feature');
    });

    it('should parse priority from tags', () => {
      const event: ForumPostEvent = {
        type: 'forum_post_created',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        postId: 'post-1',
        title: 'Test',
        content: 'Content',
        authorId: 'user-1',
        authorName: 'User',
        appliedTags: ['Urgent', 'Critical'],
        timestamp: new Date().toISOString(),
      };

      const ticket = bridge.createTicketFromPost(event, 'user');
      expect(ticket.priority).toBe('urgent');
    });
  });

  describe('createPostFromTicket', () => {
    it('should create forum post from ticket', async () => {
      const ticket = ticketManager.create({
        title: 'New feature',
        description: 'Feature description',
        type: 'feature',
        priority: 'high',
        guildId: 'guild-1',
        createdBy: 'ai',
        createdById: 'squire',
      });

      await bridge.createPostFromTicket(ticket, 'forum-channel-1', 'squire');

      expect(mockSendForumPost).toHaveBeenCalledWith({
        forumChannelId: 'forum-channel-1',
        title: 'New feature',
        content: 'Feature description',
        tags: expect.arrayContaining([
          '✨ Feature',
          'Priority: High',
        ]),
      });
    });

    it('should warn if no sendForumPost handler', async () => {
      const bridgeWithoutHandler = new ForumBridge({ ticketManager });
      const consoleSpy = vi.spyOn(console, 'warn');

      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const result = await bridgeWithoutHandler.createPostFromTicket(ticket, 'forum-1', 'user-1');
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update ticket status and sync tags', async () => {
      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        type: 'bug',
        priority: 'high',
        status: 'open',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        forumPostId: 'post-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      bridge.watchChannel('forum-1');
      await bridge.updateStatus(ticket.ticketId, 'in_progress');

      const updated = ticketManager.get(ticket.ticketId);
      expect(updated?.status).toBe('in_progress');
      expect(mockUpdateForumTags).toHaveBeenCalled();
    });

    it('should not sync tags if no forum post', async () => {
      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      await bridge.updateStatus(ticket.ticketId, 'done');

      expect(mockUpdateForumTags).not.toHaveBeenCalled();
    });
  });

  describe('assignTicket', () => {
    it('should assign ticket and sync tags', async () => {
      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        forumPostId: 'post-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      bridge.watchChannel('forum-1');
      await bridge.assignTicket(ticket.ticketId, 'ai');

      const updated = ticketManager.get(ticket.ticketId);
      expect(updated?.assignee).toBe('ai');
      expect(mockUpdateForumTags).toHaveBeenCalled();
    });
  });

  describe('postReply', () => {
    it('should post reply to forum thread', async () => {
      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        forumChannelId: 'forum-1',
        forumPostId: 'post-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      await bridge.postReply(ticket.ticketId, 'I am working on this');

      expect(mockSendForumReply).toHaveBeenCalledWith('post-1', 'I am working on this');

      const comments = ticketManager.getComments(ticket.ticketId);
      expect(comments.length).toBe(1);
      expect(comments[0].isStatusUpdate).toBe(true);
    });

    it('should warn if no forum post', async () => {
      const ticket = ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const consoleSpy = vi.spyOn(console, 'warn');
      await bridge.postReply(ticket.ticketId, 'Reply');

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('getTicketByPostId', () => {
    it('should retrieve ticket by post ID', () => {
      ticketManager.create({
        title: 'Test',
        description: 'Test',
        guildId: 'guild-1',
        forumPostId: 'post-123',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const result = bridge.getTicketByPostId('post-123');
      expect(result).not.toBeNull();
    });

    it('should return null for non-existent post', () => {
      const result = bridge.getTicketByPostId('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('createForumBridge factory', () => {
    it('should create bridge instance', () => {
      const bridge = createForumBridge({ ticketManager });
      expect(bridge).toBeInstanceOf(ForumBridge);
    });
  });
});
