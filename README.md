# Squire

Personal AI assistant with memory, skills, and scheduling capabilities.

## Project Structure

```
squire/
├── squire/              # Core package (@squire/core)
│   └── src/
│       ├── squire.ts    # Main Squire class
│       ├── types.ts     # Type definitions
│       ├── sdk/         # AI SDK clients (Claude, Gemini, Codex)
│       ├── memory/      # Memory system (QMD wrapper)
│       ├── skills/      # Skills system
│       ├── scheduler/   # Task scheduling
│       └── tickets/     # Ticket tracking
└── squire-bot/          # Discord bot
    └── src/
        ├── index.ts         # Entry point
        ├── handlers/        # DM, forum, questions, slash commands
        └── plugins/         # Plugin system
```

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Install QMD (Memory Backend) - Optional

QMD provides persistent memory with local embeddings. Without it, Squire works but won't remember past conversations.

```bash
bun install -g @tobilu/qmd
```

Or with npm:
```bash
npm install -g @tobilu/qmd
```

**Setup collections** (required for QMD to index your content):
```bash
# Add collections for your notes/docs
qmd collection add ~/notes --name notes
qmd collection add ~/Documents --name docs

# Generate embeddings for semantic search
qmd embed
```

QMD runs as an MCP server. Squire will connect to it automatically when the memory system is initialized.

### 3. Build

```bash
bun run build
```

### 4. Initialize SquireBot

Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications), then:

```bash
cd squire-bot
bun run start init \
  --token=YOUR_DISCORD_BOT_TOKEN \
  --app-id=YOUR_DISCORD_APP_ID \
  --provider=claude
```

This creates `~/.squirebot/config.json` with your settings.

### 5. Start the Bot

```bash
bun run start
```

That's it! You can now:
- DM the bot directly
- Mention it in guild channels
- Use slash commands (`/status`, `/memory`, `/help`)

## Configuration

Config file: `~/.squirebot/config.json`

```json
{
  "discordToken": "your-bot-token",
  "discordAppId": "your-app-id",
  "squire": {
    "provider": "claude",
    "permissionMode": "autoSafe"
  },
  "plugins": {
    "safeMode": false,
    "autoEnable": true
  }
}
```

**Provider options:** `claude`, `gemini`, `codex`

**Permission modes:** `strict`, `autoSafe`, `permissive`

## Features

### Slash Commands
| Command | Description |
|---------|-------------|
| `/status` | Check Squire status |
| `/memory remember <text>` | Store in memory |
| `/memory recall <query>` | Search memories |
| `/memory overview` | Get memory overview |
| `/task schedule` | Schedule a task |
| `/task list` | List scheduled tasks |
| `/config provider <name>` | Switch AI provider |
| `/help` | Get help |

### Message Handling
- **DMs**: Message the bot directly
- **Guild channels**: Mention the bot (@Squire)
- **Forum posts**: Auto-watched via forum-handler plugin

### AskUserQuestion
When the AI needs input, it shows an interactive button UI:
- Single-select: Click to answer
- Multi-select: Toggle multiple options, then submit
- "Other": Type custom answer
- Expiration handling with resend request

### Plugin System
Plugins in `~/.squirebot/plugins/` or `squire-bot/plugins/`:
- Hot reload support
- Safe mode (`--safe` flag disables all plugins)
- Direct Discord.js access

**Bundled plugins:**
- `forum-handler` - Watches forum channels

### Memory System (QMD) - Optional
- Local embeddings (fully private)
- Hybrid search (vector + BM25)
- Automatic context injection
- **Without QMD**: Squire still works, just without persistent memory

### Message Queuing
Messages are queued while AI is processing - no lost messages!

## Development

```bash
# Development with auto-reload
bun run dev

# Type check
bun x tsc --noEmit

# Build
bun run build
```

## Architecture

SquireBot is a standalone Discord bot that uses Squire core directly:

```
Discord ←→ squire-bot ←→ Squire Core ←→ AI SDK (Claude/Gemini/Codex)
                              ↓
                        Memory (QMD)
                              ↓
                        Skills/Plugins
```

## Documentation

**Phase Plans:**
- [Phase 1: Core Package](docs/phase-1-core.md)
- [Phase 2: Memory System](docs/phase-2-memory.md)
- [Phase 3: Skills System](docs/phase-3-skills.md)
- [Phase 4: Scheduler](docs/phase-4-scheduler.md)
- [Phase 7: DisCode Integration](docs/phase-7-discode-integration.md)
- [Architecture Decision](docs/ARCHITECTURE-DECISION.md)

## Status

- [x] Core package with SDK clients
- [x] Discord bot (DM, guild, forum)
- [x] Slash commands
- [x] AskUserQuestion UI
- [x] Memory system (QMD)
- [x] Skills system
- [x] Scheduler
- [x] Plugin system
- [x] Message queuing
