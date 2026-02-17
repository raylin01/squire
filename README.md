# Squire

Personal AI assistant with memory, skills, and scheduling capabilities.

## Project Structure

```
squire/
├── docs/                # Documentation and phase plans
├── squire/              # Core package (@squire/core)
│   └── src/
│       ├── squire.ts    # Main Squire class
│       ├── types.ts     # Type definitions
│       ├── config.ts    # Configuration management
│       └── index.ts     # Public API
└── squire-bot/          # Minimal Discord bot
    └── src/
        ├── index.ts         # Entry point
        ├── ws-server.ts     # WebSocket server
        └── handlers/        # DM, forum, channel ops
```

## Architecture

Squire uses a dual-connection architecture where runner-agent connects to both:

1. **DisCode Bot** - For sessions and projects
2. **SquireBot** - For DMs, forums, and channel management

See [docs/ARCHITECTURE-DECISION.md](docs/ARCHITECTURE-DECISION.md) for details.

## Quick Start

### Install Dependencies

```bash
# Core package
cd squire && npm install

# Discord bot
cd ../squire-bot && npm install
```

### Install QMD (Memory Backend)

Squire uses [QMD](https://github.com/tobi/qmd) for persistent memory with local embeddings:

```bash
npm install -g @tobilu/qmd

# Initialize QMD data directory
qmd init --data-dir ~/.squire/data/qmd
```

### Build

```bash
cd squire && npm run build
cd ../squire-bot && npm run build
```

### Configure SquireBot

```bash
cd squire-bot
node dist/index.js init \
  --token=YOUR_DISCORD_BOT_TOKEN \
  --app-id=YOUR_DISCORD_APP_ID
```

Save the generated runner token - you'll need it for runner-agent.

### Start SquireBot

```bash
node dist/index.js
```

## Documentation

See the [docs](docs/) folder for detailed phase plans:

- [Phase 1: Core Package](docs/phase-1-core.md)
- [Phase 2: Memory System](docs/phase-2-memory.md)
- [Phase 3: Skills System](docs/phase-3-skills.md)
- [Phase 4: Scheduler](docs/phase-4-scheduler.md)
- [Phase 5: Workspaces](docs/phase-5-workspaces.md)
- [Phase 6: SquireBot](docs/phase-6-squirebot.md)
- [Phase 7: DisCode Integration](docs/phase-7-discode-integration.md)
- [Phase 8: Discussion Board](docs/phase-8-discussion-board.md)

## WebSocket Protocol

SquireBot accepts connections from runner-agent at `ws://localhost:3123` (default).

### Authentication

```json
{ "type": "auth", "data": { "token": "RUNNER_TOKEN" } }
```

### Events (Bot → Runner)

```json
{ "type": "event", "data": { "type": "dm_received", "userId": "...", "content": "..." } }
{ "type": "event", "data": { "type": "forum_post_created", "postId": "...", "title": "..." } }
```

### Operations (Runner → Bot)

```json
{ "type": "create_channel", "requestId": "123", "data": { "name": "progress", "guildId": "..." } }
{ "type": "send_message", "requestId": "124", "data": { "channelId": "...", "content": "Hello!" } }
```

## Development Status

- [x] Core package structure
- [x] Configuration management
- [x] Type definitions
- [x] SquireBot WebSocket server
- [x] DM passthrough handler
- [x] Forum post handler
- [x] Channel operations handler
- [ ] Memory system via QMD (Phase 2) - using [QMD](https://github.com/tobi/qmd)
- [ ] Skills system (Phase 3)
- [ ] Scheduler (Phase 4)
- [ ] Ticket tracker (Phase 8)

## Key Features

### Memory System (QMD)

Squire uses QMD for intelligent memory storage and retrieval:
- **Local embeddings** via node-llama-cpp (fully private, no API calls)
- **Hybrid search** combining vector similarity + BM25 full-text search
- **LLM reranking** for improved relevance
- **Built-in MCP server** for direct AI tool access
