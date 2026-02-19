/**
 * Squire Communication Tool
 *
 * The ONLY way for Squire to communicate with users.
 * All output to users MUST go through this tool - regular output is NOT sent to Discord.
 */

import { defineTool } from './registry.js';

export type MessageType = 'text' | 'embed' | 'file';

export interface CommunicationOptions {
  /** Type of message */
  type: MessageType;

  /** Text content (for text type or embed description) */
  content?: string;

  /** Embed title (for embed type) */
  title?: string;

  /** Embed color (for embed type): green, red, yellow, blue, orange, purple */
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'orange' | 'purple';

  /** File path (for file type) - supports ANY file type: images, videos, code, documents, etc. */
  filePath?: string;

  /** Whether to ping the user */
  ping?: boolean;
}

// Communication handlers - set by the Squire instance
let communicationHandler: ((options: CommunicationOptions) => Promise<string>) | null = null;

/**
 * Set the communication handler.
 * Called by Squire to connect this tool to the actual output mechanism.
 */
export function setCommunicationHandler(
  handler: (options: CommunicationOptions) => Promise<string>
): void {
  communicationHandler = handler;
}

/**
 * Send a message to the user.
 * This is the ONLY way Squire communicates - regular output is NOT sent to Discord.
 */
export async function communicate(options: CommunicationOptions): Promise<string> {
  if (!communicationHandler) {
    // Fallback to console if no handler set
    console.log('[Squire]', options.content || options.title || 'Communication');
    return 'Message logged to console';
  }
  return communicationHandler(options);
}

// Register the communicate tool
defineTool(
  'squire_communicate',
  'Send a message to the user on Discord. This is the ONLY way to communicate - your regular text output is NOT automatically sent. Use this for ALL messages, responses, status updates, and file sharing.',
  {
    type: {
      type: 'string',
      description: 'Type of message: text (simple message), embed (rich formatted message with title/color), file (attach any file type - images, videos, code, documents, etc.)',
      enum: ['text', 'embed', 'file'],
    },
    content: {
      type: 'string',
      description: 'Text content for text messages, description for embeds, or optional message with file',
    },
    title: {
      type: 'string',
      description: 'Title for embed messages (required for embed type)',
    },
    color: {
      type: 'string',
      description: 'Color for embed: green (success), red (error), yellow (warning), blue (info), orange, purple',
      enum: ['green', 'red', 'yellow', 'blue', 'orange', 'purple'],
    },
    filePath: {
      type: 'string',
      description: 'Local file path to attach. Supports ANY file type: images (.png, .jpg, .gif), videos (.mp4, .mov), code files (.ts, .js, .py), documents (.pdf, .txt), etc.',
    },
    ping: {
      type: 'boolean',
      description: 'Whether to notify/ping the user',
    },
  },
  ['type'],
  async (input: Record<string, unknown>) => {
    const options: CommunicationOptions = {
      type: input.type as MessageType,
      content: input.content as string | undefined,
      title: input.title as string | undefined,
      color: input.color as CommunicationOptions['color'],
      filePath: input.filePath as string | undefined,
      ping: input.ping as boolean | undefined,
    };

    return communicate(options);
  }
);

// Convenience functions for common use cases

export async function sendText(content: string, ping = false): Promise<string> {
  return communicate({ type: 'text', content, ping });
}

export async function sendEmbed(
  title: string,
  description: string,
  color: CommunicationOptions['color'] = 'blue'
): Promise<string> {
  return communicate({ type: 'embed', title, content: description, color });
}

export async function sendSuccess(title: string, description: string): Promise<string> {
  return sendEmbed(title, description, 'green');
}

export async function sendError(title: string, description: string): Promise<string> {
  return sendEmbed(title, description, 'red');
}

export async function sendWarning(title: string, description: string): Promise<string> {
  return sendEmbed(title, description, 'yellow');
}

export async function sendFile(filePath: string, content?: string): Promise<string> {
  return communicate({ type: 'file', filePath, content });
}
