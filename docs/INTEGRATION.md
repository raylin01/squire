# runner-agent Integration

How to integrate Squire with the DisCode runner-agent for dual-connection mode.

## Overview

The runner-agent can connect to **both** DisCode Bot and SquireBot simultaneously:

```
┌─────────────────────────────────────────────────────────────────┐
│                         RUNNER-AGENT                             │
│                                                                  │
│  Plugins: claude-sdk, codex-sdk, gemini-sdk, tmux, SQUIRE      │
│                                                                  │
│  Dual WebSocket Connections:                                     │
│  - DisCode Bot (ws://localhost:3122) → Sessions, projects       │
│  - SquireBot (ws://localhost:3123) → DMs, forums, channels      │
└─────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────┐                  ┌─────────────────────────────┐
│  DISCODE BOT    │                  │  SQUIRE BOT                 │
│  (existing)     │                  │  (new)                      │
│                 │                  │                             │
│  - Sessions     │                  │  - DM passthrough           │
│  - Projects     │                  │  - Forum passthrough        │
│  - Multi-user   │                  │  - Channel API for AI       │
└─────────────────┘                  └─────────────────────────────┘
```

## Setup

### 1. Copy Squire Plugin to DisCode

The squire-plugin must be in the DisCode runner-agent:

```bash
# From DisCode repo root
cp -r /path/to/squire/squire/src /runner-agent/src/squire-core
cp -r /path/to/squire/runner-agent/src/squire-plugin /runner-agent/src/
```

Or use a symlink for development:

```bash
cd /path/to/DisCode/runner-agent/src
ln -s /path/to/squire/runner-agent/src/squire-plugin squire-plugin
ln -s /path/to/squire/squire/src squire-core
```

### 2. Configure runner-agent

Add Squire configuration to your runner-agent config:

```json
{
  "runnerId": "my-runner",
  "botUrl": "ws://localhost:3122",
  "token": "discode_bot_token",

  "squire": {
    "enabled": true,
    "name": "Squire",
    "dataDir": "~/.squire/data",
    "daemonMode": true,

    "memory": {
      "enabled": true,
      "provider": "qmd",
      "retentionDays": 90
    },

    "skills": {
      "bundled": ["memory", "web", "discord"],
      "additional": [],
      "autoInstall": true
    },

    "permissions": {
      "mode": "confirm",
      "allowedTools": [],
      "blockedTools": []
    },

    "squireBot": {
      "enabled": true,
      "url": "ws://localhost:3123",
      "token": "squire_bot_runner_token"
    }
  }
}
```

### 3. Register Plugin with Plugin Manager

Update `runner-agent/src/plugins/plugin-manager.ts`:

```typescript
import { squirePlugin } from '../squire-plugin/index.js';

// In the plugin registration section:
plugins.register(squirePlugin);
```

### 4. Install Additional Dependencies

The squire plugin requires these packages in runner-agent:

```bash
cd runner-agent
npm install ws yaml better-sqlite3 @modelcontextprotocol/sdk
```

## Available Tools

When Squire is enabled, these tools become available to the AI:

### Memory Tools

| Tool | Description |
|------|-------------|
| `memory_remember` | Store information in long-term memory |
| `memory_recall` | Search memories semantically |
| `memory_forget` | Remove memories matching query |

### Scheduler Tools

| Tool | Description |
|------|-------------|
| `schedule_task` | Schedule a task (once, interval, cron) |
| `list_tasks` | List scheduled tasks |
| `cancel_task` | Cancel a scheduled task |

### Discord Tools (via SquireBot)

| Tool | Description |
|------|-------------|
| `discord_create_channel` | Create a new Discord channel |
| `discord_send_message` | Send a message to a channel |
| `discord_rename_channel` | Rename a channel |
| `discord_create_forum_post` | Create a forum post |

### Ticket Tools

| Tool | Description |
|------|-------------|
| `ticket_create` | Create a new ticket |
| `ticket_list` | List tickets with filters |
| `ticket_update` | Update ticket status/assignee |
| `ticket_claim` | Claim a ticket for AI to work on |

### Skills Tools

| Tool | Description |
|------|-------------|
| `list_skills` | List available skills |

## Tool Examples

### Memory

```json
// Remember something
{
  "name": "memory_remember",
  "input": {
    "content": "User prefers dark mode in all applications",
    "source": "user"
  }
}

// Recall memories
{
  "name": "memory_recall",
  "input": {
    "query": "UI preferences",
    "limit": 5
  }
}
```

### Scheduler

```json
// Schedule a daily task
{
  "name": "schedule_task",
  "input": {
    "description": "Check for stale tickets",
    "schedule_type": "cron",
    "schedule_value": "0 9 * * *"
  }
}

// Schedule a one-time task
{
  "name": "schedule_task",
  "input": {
    "description": "Remind user about meeting",
    "schedule_type": "once",
    "schedule_value": "2024-02-20T14:00:00Z"
  }
}
```

### Discord

```json
// Create a progress channel
{
  "name": "discord_create_channel",
  "input": {
    "name": "ticket-123-progress",
    "guild_id": "123456789",
    "topic": "Working on bug fix for login issue"
  }
}

// Send status update
{
  "name": "discord_send_message",
  "input": {
    "channel_id": "123456789",
    "content": "Fixed the login bug! Ready for testing.",
    "embed_title": "Bug Fixed",
    "embed_color": "green"
  }
}
```

## WebSocket Protocol

### Connect to SquireBot

```javascript
const ws = new WebSocket('ws://localhost:3123');

// Authenticate
ws.send(JSON.stringify({
  type: 'auth',
  data: { token: 'your_runner_token' }
}));

// Handle responses
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'auth_success') {
    console.log('Connected to SquireBot');
  }

  if (message.type === 'event') {
    // Handle DMs, forum posts, etc.
    console.log('Event:', message.data);
  }
};
```

### Send Operations

```javascript
// Create a channel
ws.send(JSON.stringify({
  type: 'create_channel',
  requestId: 'req-123',
  data: {
    name: 'my-channel',
    guildId: '123456789'
  }
}));

// Response
// { type: 'operation_result', data: { requestId: 'req-123', success: true, data: { channelId: '...' } } }
```

## Troubleshooting

### SquireBot not connecting

1. Check SquireBot is running: `ps aux | grep squire-bot`
2. Check WebSocket port is open: `lsof -i :3123`
3. Verify token in config matches runner-agent config

### Memory not working

1. Verify QMD is installed: `which qmd`
2. Check QMD data directory exists: `ls ~/.squire/data/qmd`
3. Test QMD directly: `qmd mcp --data-dir ~/.squire/data/qmd`

### Skills not loading

1. Check skills directory: `ls ~/.squire/data/skills`
2. Check bundled skills: `ls squire/src/skills/bundled`
3. Review logs for eligibility errors

### Plugin not loading

1. Check plugin is registered in plugin-manager.ts
2. Verify all dependencies are installed
3. Check for TypeScript errors: `npm run build`
