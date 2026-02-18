import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TicketManager, createTicketManager, CreateTicketOptions } from './manager.js';
import type { Ticket, TicketType, TicketStatus, TicketPriority, TicketAssignee } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TicketManager', () => {
  let manager: TicketManager;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));
    dbPath = path.join(tempDir, 'test.db');
    manager = new TicketManager(dbPath);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new ticket', () => {
      const options: CreateTicketOptions = {
        title: 'Test Bug',
        description: 'This is a test bug',
        type: 'bug',
        priority: 'high',
        guildId: 'guild-123',
        createdBy: 'user',
        createdById: 'user-456',
      };

      const ticket = manager.create(options);

      expect(ticket.ticketId).toBeDefined();
      expect(ticket.title).toBe('Test Bug');
      expect(ticket.description).toBe('This is a test bug');
      expect(ticket.type).toBe('bug');
      expect(ticket.priority).toBe('high');
      expect(ticket.status).toBe('open');
      expect(ticket.assignee).toBe('unassigned');
    });

    it('should create ticket with default values', () => {
      const options: CreateTicketOptions = {
        title: 'Simple task',
        description: 'Do something',
        guildId: 'guild-123',
        createdBy: 'ai',
        createdById: 'squire',
      };

      const ticket = manager.create(options);

      expect(ticket.type).toBe('task');
      expect(ticket.priority).toBe('normal');
      expect(ticket.status).toBe('open');
    });

    it('should create ticket with forum post association', () => {
      const options: CreateTicketOptions = {
        title: 'Forum ticket',
        description: 'From Discord',
        guildId: 'guild-123',
        forumChannelId: 'channel-789',
        forumPostId: 'post-101',
        createdBy: 'user',
        createdById: 'user-456',
      };

      const ticket = manager.create(options);

      expect(ticket.forumPostId).toBe('post-101');
      expect(ticket.forumChannelId).toBe('channel-789');
    });
  });

  describe('get', () => {
    it('should retrieve ticket by ID', () => {
      const created = manager.create({
        title: 'Find me',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const retrieved = manager.get(created.ticketId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.ticketId).toBe(created.ticketId);
    });

    it('should return null for non-existent ticket', () => {
      const result = manager.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getByForumPostId', () => {
    it('should retrieve ticket by forum post ID', () => {
      manager.create({
        title: 'Forum ticket',
        description: 'Test',
        guildId: 'guild-1',
        forumPostId: 'post-123',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const retrieved = manager.getByForumPostId('post-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('Forum ticket');
    });

    it('should return null for non-existent forum post', () => {
      const result = manager.getByForumPostId('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update ticket status', () => {
      const ticket = manager.create({
        title: 'To update',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const updated = manager.update(ticket.ticketId, { status: 'in_progress' });

      expect(updated?.status).toBe('in_progress');
    });

    it('should update ticket assignee', () => {
      const ticket = manager.create({
        title: 'To assign',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const updated = manager.update(ticket.ticketId, {
        assignee: 'ai',
        assigneeUserId: 'squire'
      });

      expect(updated?.assignee).toBe('ai');
      expect(updated?.assigneeUserId).toBe('squire');
    });

    it('should update multiple fields', () => {
      const ticket = manager.create({
        title: 'Original',
        description: 'Original desc',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const updated = manager.update(ticket.ticketId, {
        title: 'Updated',
        priority: 'urgent',
        status: 'review',
      });

      expect(updated?.title).toBe('Updated');
      expect(updated?.priority).toBe('urgent');
      expect(updated?.status).toBe('review');
    });

    it('should update aiContext', () => {
      const ticket = manager.create({
        title: 'AI task',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const updated = manager.update(ticket.ticketId, {
        aiContext: {
          suggestedApproach: 'Do X first',
          relatedFiles: ['src/index.ts'],
        },
      });

      expect(updated?.aiContext?.suggestedApproach).toBe('Do X first');
    });

    it('should return unchanged ticket if no updates', () => {
      const ticket = manager.create({
        title: 'No changes',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const updated = manager.update(ticket.ticketId, {});
      expect(updated?.updatedAt).toBe(ticket.updatedAt);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Create various tickets for searching
      const ticket1 = manager.create({
        title: 'Bug 1',
        description: 'Test',
        type: 'bug',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });
      manager.update(ticket1.ticketId, { status: 'open' });

      const ticket2 = manager.create({
        title: 'Feature 1',
        description: 'Test',
        type: 'feature',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });
      manager.update(ticket2.ticketId, { status: 'in_progress', assignee: 'ai' });

      const ticket3 = manager.create({
        title: 'Task 1',
        description: 'Test',
        type: 'task',
        guildId: 'guild-2',
        createdBy: 'ai',
        createdById: 'squire',
      });
      manager.update(ticket3.ticketId, { status: 'done' });
    });

    it('should search by status', () => {
      const results = manager.search({ status: 'open' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Bug 1');
    });

    it('should search by type', () => {
      const results = manager.search({ type: 'feature' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Feature 1');
    });

    it('should search by assignee', () => {
      const results = manager.search({ assignee: 'ai' });
      expect(results.length).toBe(1);
    });

    it('should search by guild', () => {
      const results = manager.search({ guildId: 'guild-1' });
      expect(results.length).toBe(2);
    });

    it('should combine filters', () => {
      const results = manager.search({
        status: 'in_progress',
        guildId: 'guild-1',
      });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Feature 1');
    });

    it('should limit results', () => {
      const results = manager.search({ guildId: 'guild-1', limit: 1 });
      expect(results.length).toBe(1);
    });

    it('should return all with no filters', () => {
      const results = manager.search();
      expect(results.length).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete a ticket', () => {
      const ticket = manager.create({
        title: 'To delete',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const deleted = manager.delete(ticket.ticketId);
      expect(deleted).toBe(true);
      expect(manager.get(ticket.ticketId)).toBeNull();
    });

    it('should return false for non-existent ticket', () => {
      const deleted = manager.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('addComment', () => {
    it('should add a comment to a ticket', () => {
      const ticket = manager.create({
        title: 'Comment test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const comment = manager.addComment(
        ticket.ticketId,
        'This is a comment',
        'user',
        'user-1'
      );

      expect(comment.commentId).toBeDefined();
      expect(comment.content).toBe('This is a comment');
      expect(comment.author).toBe('user');
    });

    it('should add AI comment with flags', () => {
      const ticket = manager.create({
        title: 'AI comment test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const comment = manager.addComment(
        ticket.ticketId,
        'I have a question',
        'ai',
        'squire',
        { isAiQuestion: true }
      );

      expect(comment.isAiQuestion).toBe(true);
    });

    it('should update ticket updated_at on comment', async () => {
      const ticket = manager.create({
        title: 'Update test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const originalUpdatedAt = ticket.updatedAt;

      // Wait to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.addComment(ticket.ticketId, 'New comment', 'user', 'user-1');

      const updated = manager.get(ticket.ticketId);
      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('getComments', () => {
    it('should get all comments for a ticket', () => {
      const ticket = manager.create({
        title: 'Multi comment',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      manager.addComment(ticket.ticketId, 'Comment 1', 'user', 'user-1');
      manager.addComment(ticket.ticketId, 'Comment 2', 'ai', 'squire');
      manager.addComment(ticket.ticketId, 'Comment 3', 'user', 'user-2');

      const comments = manager.getComments(ticket.ticketId);
      expect(comments.length).toBe(3);
      expect(comments[0].content).toBe('Comment 1');
      expect(comments[1].content).toBe('Comment 2');
      expect(comments[2].content).toBe('Comment 3');
    });

    it('should return empty array for no comments', () => {
      const ticket = manager.create({
        title: 'No comments',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      const comments = manager.getComments(ticket.ticketId);
      expect(comments).toEqual([]);
    });
  });

  describe('linkSession', () => {
    it('should link a session to a ticket', () => {
      const ticket = manager.create({
        title: 'Session link test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      manager.linkSession(ticket.ticketId, 'session-123');

      const updated = manager.get(ticket.ticketId);
      expect(updated?.relatedSessionIds).toContain('session-123');
    });

    it('should not duplicate sessions', () => {
      const ticket = manager.create({
        title: 'Duplicate test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      manager.linkSession(ticket.ticketId, 'session-123');
      manager.linkSession(ticket.ticketId, 'session-123');

      const updated = manager.get(ticket.ticketId);
      expect(updated?.relatedSessionIds.length).toBe(1);
    });
  });

  describe('linkCommit', () => {
    it('should link a commit to a ticket', () => {
      const ticket = manager.create({
        title: 'Commit link test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      manager.linkCommit(ticket.ticketId, 'abc123');

      const updated = manager.get(ticket.ticketId);
      expect(updated?.linkedCommitShas).toContain('abc123');
    });
  });

  describe('linkPR', () => {
    it('should link a PR to a ticket', () => {
      const ticket = manager.create({
        title: 'PR link test',
        description: 'Test',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'user-1',
      });

      manager.linkPR(ticket.ticketId, 'https://github.com/repo/pull/1');

      const updated = manager.get(ticket.ticketId);
      expect(updated?.linkedPrUrls).toContain('https://github.com/repo/pull/1');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      const t1 = manager.create({
        title: 'Bug open',
        description: '',
        type: 'bug',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'u1',
      });
      manager.update(t1.ticketId, { status: 'open' });

      const t2 = manager.create({
        title: 'Bug done',
        description: '',
        type: 'bug',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'u1',
      });
      manager.update(t2.ticketId, { status: 'done' });

      const t3 = manager.create({
        title: 'Feature in progress',
        description: '',
        type: 'feature',
        guildId: 'guild-1',
        createdBy: 'user',
        createdById: 'u1',
      });
      manager.update(t3.ticketId, { status: 'in_progress', assignee: 'ai' });

      const t4 = manager.create({
        title: 'Task from other guild',
        description: '',
        type: 'task',
        guildId: 'guild-2',
        createdBy: 'user',
        createdById: 'u1',
      });
      manager.update(t4.ticketId, { status: 'open' });
    });

    it('should return global stats', () => {
      const stats = manager.getStats();

      expect(stats.total).toBe(4);
      expect(stats.byStatus.open).toBe(2);
      expect(stats.byStatus.done).toBe(1);
      expect(stats.byStatus.in_progress).toBe(1);
      expect(stats.byType.bug).toBe(2);
      expect(stats.byType.feature).toBe(1);
      expect(stats.byType.task).toBe(1);
    });

    it('should return stats filtered by guild', () => {
      const stats = manager.getStats('guild-1');

      expect(stats.total).toBe(3);
      expect(stats.byStatus.open).toBe(1);
      expect(stats.byStatus.done).toBe(1);
    });
  });

  describe('createTicketManager factory', () => {
    it('should create manager instance', () => {
      const manager = createTicketManager(dbPath);
      expect(manager).toBeInstanceOf(TicketManager);
      manager.close();
    });
  });
});
