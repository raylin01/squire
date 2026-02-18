/**
 * Squire Communication Tool
 *
 * The primary way for Squire to communicate with users.
 * All output to users should go through this tool.
 */

import { defineTool } from './index.js';

export type MessageType = 'text' | 'embed' | 'file' | 'image';

export interface CommunicationOptions {
  /** Type of message */
  type: MessageType;

  /** Text content (for text type or embed description) */
  content?: string;

  /** Embed title (for embed type) */
  title?: string;

  /** Embed color (for embed type): green, red, yellow, blue, orange, purple */
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'orange' | 'purple';

  /** File path (for file/image type) */
  filePath?: string;

  /** Image URL (for image type) */
  imageUrl?: string;

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
 * This is the primary way Squire communicates.
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
  'Send a message to the user. This is the ONLY way to communicate with the user. Use this for all outputs, status updates, questions, and results.',
  {
    type: {
      type: 'string',
      description: 'Type of message: text, embed, file, or image',
      enum: ['text', 'embed', 'file', 'image'],
    },
    content: {
      type: 'string',
      description: 'Text content for text messages, or description for embeds',
    },
    title: {
      type: 'string',
      description: 'Title for embed messages',
    },
    color: {
      type: 'string',
      description: 'Color for embed: green, red, yellow, blue, orange, purple',
      enum: ['green', 'red', 'yellow', 'blue', 'orange', 'purple'],
    },
    filePath: {
      type: 'string',
      description: 'Path to file for file/image type',
    },
    imageUrl: {
      type: 'string',
      description: 'URL of image for image type',
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
      imageUrl: input.imageUrl as string | undefined,
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

export async function sendImage(imageUrl: string, content?: string): Promise<string> {
  return communicate({ type: 'image', imageUrl, content });
}
