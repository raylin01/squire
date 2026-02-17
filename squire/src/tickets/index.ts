/**
 * Tickets Module
 *
 * Provides ticket tracking via Discord forum channels.
 */

export { TicketManager, createTicketManager } from './manager.js';
export type { CreateTicketOptions, UpdateTicketOptions, TicketSearchOptions } from './manager.js';

export { ForumBridge, createForumBridge, DEFAULT_TAG_MAPPINGS } from './forum-bridge.js';
export type { ForumBridgeOptions, CreateForumPostOptions, ForumPostEvent } from './forum-bridge.js';
