import { describe, expect, it } from 'vitest';
import { evaluateDiscordAccess } from './access-control.js';

const user = 'user-1';
const guild = 'guild-1';

describe('evaluateDiscordAccess', () => {
  it('allows everyone when both lists are empty', () => {
    expect(evaluateDiscordAccess({}, { userId: user, guildId: guild })).toEqual({
      allowed: true,
    });
    expect(evaluateDiscordAccess({ allowedUsers: [], allowedGuilds: [] }, { userId: user })).toEqual({
      allowed: true,
    });
  });

  it('enforces allowedUsers', () => {
    const config = { allowedUsers: [user] };
    expect(evaluateDiscordAccess(config, { userId: user, guildId: guild }).allowed).toBe(true);
    expect(evaluateDiscordAccess(config, { userId: 'other', guildId: guild })).toEqual({
      allowed: false,
      reason: 'user not in allowedUsers',
    });
  });

  it('enforces allowedGuilds for guild messages', () => {
    const config = { allowedGuilds: [guild] };
    expect(evaluateDiscordAccess(config, { userId: user, guildId: guild }).allowed).toBe(true);
    expect(evaluateDiscordAccess(config, { userId: user, guildId: 'other-guild' })).toEqual({
      allowed: false,
      reason: 'guild not in allowedGuilds',
    });
  });

  it('blocks DMs when only allowedGuilds is set', () => {
    expect(evaluateDiscordAccess({ allowedGuilds: [guild] }, { userId: user })).toEqual({
      allowed: false,
      reason: 'DMs are blocked when allowedGuilds is set without allowedUsers',
    });
  });

  it('allows DMs for allowlisted users even when allowedGuilds is set', () => {
    const config = { allowedUsers: [user], allowedGuilds: [guild] };
    expect(evaluateDiscordAccess(config, { userId: user }).allowed).toBe(true);
    expect(evaluateDiscordAccess(config, { userId: 'other' }).allowed).toBe(false);
  });
});
