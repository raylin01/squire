/**
 * Squire Ticket Tools
 *
 * Tools for managing tickets/tracking tasks and issues.
 */

import { defineTool } from './index.js';
import type { TicketManager } from '../tickets/manager.js';

let ticketManager: TicketManager | null = null;

/**
 * Set the ticket manager for the tools to use.
 */
export function setTicketManager(manager: TicketManager): void {
  ticketManager = manager;
}

// ticket_create - Create a new ticket
defineTool(
  'ticket_create',
  'Create a new ticket to track a task, bug, or feature request.',
  {
    title: {
      type: 'string',
      description: 'Title of the ticket',
    },
    description: {
      type: 'string',
      description: 'Detailed description of the ticket',
    },
    type: {
      type: 'string',
      description: 'Type of ticket',
      enum: ['task', 'bug', 'feature', 'question'],
    },
    priority: {
      type: 'string',
      description: 'Priority level',
      enum: ['low', 'normal', 'high', 'urgent'],
    },
  },
  ['title'],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const ticket = ticketManager.create({
      title: input.title as string,
      description: input.description as string || '',
      type: (input.type as 'task' | 'bug' | 'feature' | 'question') || 'task',
      priority: (input.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal',
      guildId: 'local',
      createdBy: 'ai',
      createdById: 'squire',
    });

    return `Ticket created: ${ticket.ticketId}\nTitle: ${ticket.title}\nStatus: ${ticket.status}`;
  }
);

// ticket_list - List tickets
defineTool(
  'ticket_list',
  'List tickets, optionally filtered by status or type.',
  {
    status: {
      type: 'string',
      description: 'Filter by status',
      enum: ['open', 'in_progress', 'done', 'closed'],
    },
    type: {
      type: 'string',
      description: 'Filter by type',
      enum: ['task', 'bug', 'feature', 'question'],
    },
    limit: {
      type: 'number',
      description: 'Maximum number of tickets to return (default: 10)',
    },
  },
  [],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const filters: Record<string, unknown> = {};
    if (input.status) filters.status = input.status;
    if (input.type) filters.type = input.type;

    const tickets = ticketManager.search(filters);
    const limit = (input.limit as number) || 10;
    const limited = tickets.slice(0, limit);

    if (limited.length === 0) {
      return 'No tickets found';
    }

    const formatted = limited.map((t, i) => {
      const statusEmoji = t.status === 'open' ? '🔵' : t.status === 'in_progress' ? '🟡' : '✅';
      const typeEmoji = t.type === 'bug' ? '🐛' : t.type === 'feature' ? '✨' : t.type === 'question' ? '❓' : '📋';
      return `${i + 1}. ${statusEmoji} ${typeEmoji} ${t.title}\n   ID: ${t.ticketId}\n   Priority: ${t.priority}`;
    }).join('\n\n');

    return `Tickets (${limited.length} of ${tickets.length}):\n\n${formatted}`;
  }
);

// ticket_update - Update a ticket
defineTool(
  'ticket_update',
  'Update a ticket status, assignee, or other fields.',
  {
    ticketId: {
      type: 'string',
      description: 'The ticket ID to update',
    },
    status: {
      type: 'string',
      description: 'New status',
      enum: ['open', 'in_progress', 'done', 'closed'],
    },
    assignee: {
      type: 'string',
      description: 'Assign to: user, ai, or name',
    },
    note: {
      type: 'string',
      description: 'Optional note to add as a comment',
    },
  },
  ['ticketId'],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const ticketId = input.ticketId as string;
    const updates: Record<string, unknown> = {};

    if (input.status) updates.status = input.status;
    if (input.assignee) updates.assignee = input.assignee;

    const updated = ticketManager.update(ticketId, updates);

    if (!updated) {
      return `Ticket not found: ${ticketId}`;
    }

    // Add comment if note provided
    if (input.note) {
      ticketManager.addComment(ticketId, input.note as string, 'ai', 'squire');
    }

    return `Ticket ${ticketId} updated\nStatus: ${updated.status}\nAssignee: ${updated.assignee || 'unassigned'}`;
  }
);

// ticket_claim - Claim a ticket
defineTool(
  'ticket_claim',
  'Claim a ticket by assigning it to yourself (the AI).',
  {
    ticketId: {
      type: 'string',
      description: 'The ticket ID to claim',
    },
  },
  ['ticketId'],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const ticketId = input.ticketId as string;

    const updated = ticketManager.update(ticketId, {
      assignee: 'ai',
      status: 'in_progress',
    });

    if (!updated) {
      return `Ticket not found: ${ticketId}`;
    }

    return `Claimed ticket: ${updated.title}\nStatus: in_progress\nAssigned to: ai`;
  }
);

// ticket_comment - Add a comment to a ticket
defineTool(
  'ticket_comment',
  'Add a comment or status update to a ticket.',
  {
    ticketId: {
      type: 'string',
      description: 'The ticket ID',
    },
    comment: {
      type: 'string',
      description: 'The comment to add',
    },
    isStatusUpdate: {
      type: 'boolean',
      description: 'Whether this is a status update (default: true)',
    },
  },
  ['ticketId', 'comment'],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const ticketId = input.ticketId as string;
    const comment = input.comment as string;
    const isStatusUpdate = input.isStatusUpdate !== false;

    ticketManager.addComment(ticketId, comment, 'ai', 'squire', { isStatusUpdate });

    return `Comment added to ticket ${ticketId}`;
  }
);

// ticket_get - Get ticket details
defineTool(
  'ticket_get',
  'Get detailed information about a ticket.',
  {
    ticketId: {
      type: 'string',
      description: 'The ticket ID',
    },
  },
  ['ticketId'],
  async (input: Record<string, unknown>) => {
    if (!ticketManager) {
      return 'Ticket system not initialized';
    }

    const ticketId = input.ticketId as string;
    const ticket = ticketManager.get(ticketId);

    if (!ticket) {
      return `Ticket not found: ${ticketId}`;
    }

    const comments = ticketManager.getComments(ticketId);

    let output = `Ticket: ${ticket.title}\n`;
    output += `ID: ${ticket.ticketId}\n`;
    output += `Type: ${ticket.type}\n`;
    output += `Status: ${ticket.status}\n`;
    output += `Priority: ${ticket.priority}\n`;
    output += `Assignee: ${ticket.assignee || 'unassigned'}\n`;
    output += `Created: ${ticket.createdAt}\n\n`;
    output += `Description:\n${ticket.description}\n`;

    if (comments.length > 0) {
      output += `\nComments (${comments.length}):\n`;
      for (const c of comments) {
        output += `- ${c.author}: ${c.content}\n`;
      }
    }

    return output;
  }
);
