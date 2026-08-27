/**
 * Decide whether a guild message should create a workspace / run a command.
 * Unrelated channel chatter must not allocate a Squire workspace.
 */
export function shouldHandleGuildMessage(options: {
  content: string;
  botUserId?: string | null;
  mentionedBot: boolean;
}): boolean {
  if (options.content.trim().startsWith('!')) {
    return true;
  }
  if (options.mentionedBot) {
    return true;
  }
  if (options.botUserId && options.content.includes(`<@${options.botUserId}>`)) {
    return true;
  }
  return false;
}
