# Squire Setup Guide

Complete guide to setting up Squire with runner-agent integration.

## Prerequisites

- Node.js 18+
- npm or bun
- Discord Bot Token (for SquireBot)
- QMD installed (for memory system)

## Installation

### 1. Clone and Install

```bash
git clone https://github.com/raylin01/squire.git
cd squire

# Install dependencies
npm install

# Build packages
npm run build
```

### 2. Install QMD (Memory Backend)

QMD provides local embeddings for the memory system:

```bash
# Install QMD globally
npm install -g @tobilu/qmd

# Initialize QMD data directory
mkdir -p ~/.squire/data/qmd
qmd init --data-dir ~/.squire/data/qmd
```

### 3. Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" → Name it "SquireBot"
3. Go to "Bot" → Click "Reset Token" to get your bot token
4. Enable these Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent (optional)
5. Go to "OAuth2" → "URL Generator"
6. Select scopes: `bot`, `applications.commands`
7. Select permissions:
   - Send Messages
   - Manage Channels
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads
8. Copy the invite URL and invite bot to your server

### 4. Configure SquireBot

Create the configuration file:

```bash
mkdir -p ~/.squire
cat > ~/.squire/config.json << 'EOF'
{
  "discordToken": "YOUR_DISCORD_BOT_TOKEN",
  "discordAppId": "YOUR_DISCORD_APP_ID",
  "wsPort": 3123,
  "runnerToken": "generate-a-secure-random-token-here"
}
EOF
```

Generate a secure runner token:

```bash
openssl rand -hex 32
```

### 5. Start SquireBot

```bash
cd squire-bot
node dist/index.js
```

You should see:
```
[SquireBot] Logged in as SquireBot#0000
[SquireBot] WebSocket server listening on port 3123
```

## Configuration Reference

### SquireBot Config (~/.squire/config.json)

```json
{
  "discordToken": "bot_token_from_discord",
  "discordAppId": "application_id_from_discord",
  "wsPort": 3123,
  "runnerToken": "secure_token_for_runner_agent",
  "forums": {
    "bugs": {
      "channelId": "DISCORD_FORUM_CHANNEL_ID",
      "autoAssign": "ai"
    }
  }
}
```

### Squire Core Config

The Squire instance is configured programmatically:

```typescript
import { Squire } from '@squire/core';

const squire = new Squire({
  squireId: 'my-squire',
  name: 'Squire',
  dataDir: '~/.squire/data',
  daemonMode: true,
  memory: {
    enabled: true,
    provider: 'qmd',
    retentionDays: 90,
  },
  skills: {
    bundled: ['memory', 'web', 'discord'],
    additional: [],
    autoInstall: true,
  },
  permissions: {
    mode: 'confirm',
    allowedTools: [],
    blockedTools: [],
  },
});

await squire.start();
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SQUIRE_NAME` | Instance name | Squire |
| `SQUIRE_MODEL` | Default AI model | claude-sonnet-4-20250514 |
| `SQUIRE_DAEMON` | Enable daemon mode | false |
| `SQUIRE_DATA_DIR` | Data directory | ~/.squire/data |
| `SQUIRE_PERMISSION_MODE` | Permission mode | confirm |

## Next Steps

- [Integration with runner-agent](./INTEGRATION.md)
- [WebSocket Protocol](./README.md#websocket-protocol)
- [API Reference](./API.md)
