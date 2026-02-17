#!/usr/bin/env node
/**
 * SquireBot - Minimal Discord bot for Squire
 *
 * This bot acts as a thin Discord interface, passing messages to runner-agent
 * via WebSocket and handling channel operations from the AI.
 */

import { Client, GatewayIntentBits, Events, REST, Routes, ActivityType } from 'discord.js';
import { loadConfig, saveConfig, createDefaultConfig, getConfigPath, SquireBotConfig } from './config.js';
import { SquireBotWebSocketServer } from './ws-server.js';
import { setupDmHandler } from './handlers/dm.js';
import { setupForumHandler } from './handlers/forum.js';
import { setupChannelOpsHandler } from './handlers/channel-ops.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle init command
  if (args[0] === 'init') {
    const token = args.find(a => a.startsWith('--token='))?.split('=')[1];
    const appId = args.find(a => a.startsWith('--app-id='))?.split('=')[1];
    const runnerToken = args.find(a => a.startsWith('--runner-token='))?.split('=')[1];

    if (!token || !appId) {
      console.error('Usage: squire-bot init --token=YOUR_DISCORD_BOT_TOKEN --app-id=YOUR_APP_ID [--runner-token=CUSTOM_TOKEN]');
      console.error('');
      console.error('If --runner-token is not provided, a random token will be generated.');
      console.error('Save this token - runner-agent will need it to connect.');
      process.exit(1);
    }

    const config = createDefaultConfig(token, appId, runnerToken);
    console.log(`[SquireBot] Config created at ${getConfigPath()}`);
    console.log(`[SquireBot] Runner token: ${config.runnerToken}`);
    console.log('[SquireBot] Save this token! Runner-agent will need it to connect.');
    process.exit(0);
  }

  // Load config
  let config = loadConfig();

  if (!config) {
    console.error('[SquireBot] No config found. Run `squire-bot init` first.');
    console.error(`Expected config at: ${getConfigPath()}`);
    process.exit(1);
  }

  // Allow env overrides
  if (process.env.DISCORD_TOKEN) {
    config = { ...config, discordToken: process.env.DISCORD_TOKEN };
  }
  if (process.env.DISCORD_APP_ID) {
    config = { ...config, discordAppId: process.env.DISCORD_APP_ID };
  }
  if (process.env.WS_PORT) {
    config = { ...config, wsPort: parseInt(process.env.WS_PORT, 10) };
  }

  console.log(`[SquireBot] Starting...`);
  console.log(`[SquireBot] WebSocket will listen on ${config.wsHost}:${config.wsPort}`);

  // Create Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  // Create WebSocket server
  const wsServer = new SquireBotWebSocketServer(config, client);

  // Set up handlers
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[SquireBot] Logged in as ${readyClient.user.tag}`);

    // Set status
    readyClient.user.setPresence({
      activities: [{ name: 'for tasks', type: ActivityType.Watching }],
      status: 'online',
    });

    // Set up message handlers
    setupDmHandler(client, wsServer);
    setupForumHandler(client, wsServer, config);

    // Set up channel operations handler
    setupChannelOpsHandler(client, wsServer);

    // Start WebSocket server
    wsServer.start();

    console.log('[SquireBot] Ready!');
    console.log(`[SquireBot] Connected runners will receive DMs and forum posts.`);
  });

  // Handle errors
  client.on(Events.Error, (error) => {
    console.error('[SquireBot] Discord client error:', error);
  });

  client.on(Events.Warn, (message) => {
    console.warn('[SquireBot] Discord client warning:', message);
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('[SquireBot] Shutting down...');
    wsServer.stop();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Login
  try {
    await client.login(config.discordToken);
  } catch (error) {
    console.error('[SquireBot] Failed to login:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[SquireBot] Fatal error:', error);
  process.exit(1);
});
