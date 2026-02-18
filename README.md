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
│       ├── memory/      # Memory system (markdown files)
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

### 2. Install QMD (Optional - for semantic search)

QMD is an optional MCP server that provides semantic search over your memory files. Without it, Squire still provides intelligent context (core memory + recent activity logs).

**Install QMD:**
```bash
bun install -g @tobilu/qmd
# or
npm install -g @tobilu/qmd
```

**Add Squire memory to QMD:**
```bash
# Add the squire memory directory
qmd collection add ~/.squire/memory --name squire

# Generate embeddings for semantic search
qmd embed
```

**How it works:**
- Squire manages memory as markdown files in `~/.squire/memory/`
  - `MEMORY.md` - Core memories (preferences, facts, decisions)
  - `daily/YYYY-MM-DD.md` - Daily activity logs
- QMD runs as a separate MCP server
- The AI uses QMD's MCP tools (`qmd_search`, `qmd_vector_search`) directly when available
- Without QMD, Squire provides local keyword search + intelligent context injection

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

### Memory System

Squire has a built-in memory system that manages markdown files:

**Core Memory** (`~/.squire/memory/MEMORY.md`):
- Preferences - things you like/dislike
- Facts - important information about you
- Decisions - architectural choices made
- Patterns - recurring behaviors
- Skills - your expertise areas
- Projects - knowledge about your projects

**Daily Logs** (`~/.squire/memory/daily/YYYY-MM-DD.md`):
- Commits made
- Tasks started/completed
- Learnings captured
- Notes and observations

**Intelligent Context** (always available):
- Core memory overview injected into AI prompts
- Yesterday's + today's activity logs
- Active projects identified

**With QMD** (optional MCP server):
- Semantic search across all memory files
- Vector similarity for finding related content
- AI calls QMD's MCP tools directly (`qmd_search`, `qmd_vector_search`)

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
                        Memory (markdown files)
                              ↓
                        Skills/Plugins

Optional: QMD MCP Server ←-- AI calls directly for semantic search
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
