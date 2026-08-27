/**
 * Discord allowlist enforcement for SquireBot.
 *
 * `allowedUsers` / `allowedGuilds` on ~/.squirebot/config.json were documented
 * but never checked. Empty or omitted lists stay unrestricted so existing
 * configs keep working; a startup warning is logged in that case.
 */

import type { SquireBotConfig } from './config.js';

export const ACCESS_DENIED_MESSAGE = 'You are not allowed to use this bot.';

export interface DiscordAccessIdentity {
  userId: string;
  guildId?: string | null;
}

export interface DiscordAccessDecision {
  allowed: boolean;
  reason?: string;
}

function nonEmpty(list: string[] | undefined): string[] {
  return (list ?? []).map((value) => value.trim()).filter(Boolean);
}

export function isAccessListConfigured(list: string[] | undefined): boolean {
  return nonEmpty(list).length > 0;
}

export function evaluateDiscordAccess(
  config: Pick<SquireBotConfig, 'allowedUsers' | 'allowedGuilds'>,
  identity: DiscordAccessIdentity
): DiscordAccessDecision {
  const allowedUsers = nonEmpty(config.allowedUsers);
  const allowedGuilds = nonEmpty(config.allowedGuilds);

  if (allowedUsers.length > 0 && !allowedUsers.includes(identity.userId)) {
    return { allowed: false, reason: 'user not in allowedUsers' };
  }

  if (allowedGuilds.length > 0) {
    if (!identity.guildId) {
      if (allowedUsers.length === 0) {
        return {
          allowed: false,
          reason: 'DMs are blocked when allowedGuilds is set without allowedUsers',
        };
      }
    } else if (!allowedGuilds.includes(identity.guildId)) {
      return { allowed: false, reason: 'guild not in allowedGuilds' };
    }
  }

  return { allowed: true };
}

export function warnIfAccessUnrestricted(
  config: Pick<SquireBotConfig, 'allowedUsers' | 'allowedGuilds'>
): void {
  const usersConfigured = isAccessListConfigured(config.allowedUsers);
  const guildsConfigured = isAccessListConfigured(config.allowedGuilds);
  if (!usersConfigured && !guildsConfigured) {
    console.warn(
      '[SquireBot] allowedUsers and allowedGuilds are empty. Anyone who can message this bot can use it. Set allowedUsers in ~/.squirebot/config.json for a private bot.'
    );
  }
}
