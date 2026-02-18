# Squire Self-Expandability Plan

## Vision
Enable Squire to autonomously extend its capabilities through tools, including:
- Creating and sharing tools via GitHub
- Extending Discord functionality (commands, channels, events)
- Self-updating without restarts
- Participating in a tool ecosystem

---

## Phase 1: Tool Publishing (GitHub Integration)

### Goal
Allow Squire to create a GitHub repo from a tool and share it with others.

### New Tool: `tool_publish`

```yaml
name: tool_publish
description: "Publish a tool to GitHub for sharing"
inputSchema:
  properties:
    toolName:
      type: string
      description: "Name of the tool to publish"
    repoName:
      type: string
      description: "Repository name (default: squire-tool-{toolName})"
    description:
      type: string
      description: "Repository description"
    private:
      type: boolean
      description: "Make repo private (default: false)"
  required: [toolName]
```

### Implementation Steps
1. Read tool from `~/.squire/tools/{toolName}/`
2. Create GitHub repo via REST API (`POST /user/repos`)
3. Initialize git repo if not already
4. Add remote origin
5. Push to GitHub
6. Return repo URL

### Requirements
- `GITHUB_TOKEN` environment variable
- `gh` CLI or direct API calls

### Files to Create
- `src/tools/bundled/tool_publish/tool.md`
- `src/tools/bundled/tool_publish/handler.ts`

---

## Phase 2: Discord Extension Tools

### Goal
Allow tools to extend Discord functionality without modifying core Squire.

### Architecture: Discord Extension Hooks

Tools can register hooks for Discord events:

```typescript
// In tool.md
metadata:
  squire:
    discord:
      commands:
        - name: "announce"
          description: "Make an announcement"
          usage: "!announce <message>"
      events:
        - "messageCreate"
        - "guildMemberAdd"
      channels:
        - type: "announcement"
          name: "announcements"
          permissions: ["administrator"]
```

### New Built-in Tools

#### `discord_create_channel`
```typescript
{
  name: "discord_create_channel",
  input: {
    name: "announcements",
    type: "text|voice|forum|announcement",
    category: "optional-category-name",
    topic: "Channel description",
    permissions: ["administrator", "moderator"]
  }
}
```

#### `discord_send_announcement`
```typescript
{
  name: "discord_send_announcement",
  input: {
    channel: "announcements",
    title: "Important Update",
    message: "Content here...",
    ping: "@everyone" // optional
  }
}
```

#### `discord_create_command`
```typescript
{
  name: "discord_create_command",
  input: {
    command: "subscribe",
    description: "Subscribe to announcements",
    handler: "tool://announcement-subscribe" // references another tool
  }
}
```

#### `discord_subscribe_channel`
```typescript
{
  name: "discord_subscribe_channel",
  input: {
    channelType: "announcement|log|alert",
    callback: {
      tool: "my_callback_handler",
      schedule: "on_event" // or cron expression
    }
  }
}
```

### Implementation

1. **Extension Registry** - Track registered Discord extensions
2. **Command Router** - Route `!` commands to tool handlers
3. **Event Dispatcher** - Forward Discord events to subscribed tools
4. **Permission Bridge** - Allow tools to check Discord permissions

### Files to Create
- `src/discord/extension-registry.ts`
- `src/discord/command-router.ts`
- `src/discord/event-dispatcher.ts`
- `src/tools/bundled/discord_create_channel/`
- `src/tools/bundled/discord_send_announcement/`
- `src/tools/bundled/discord_create_command/`

---

## Phase 3: Dynamic Tool Loading

### Goal
Load new tools without restarting Squire.

### Implementation

```typescript
// In ToolRegistry
async reloadTool(name: string): Promise<boolean>
async reloadAll(): Promise<void>
async watchForChanges(): Promise<void> // File watcher
```

### Hot Reload Strategy
1. Watch `~/.squire/tools/` and `./.squire/tools/` directories
2. On change detected:
   - Unload old tool
   - Parse new tool.md
   - Load new handler
   - Re-register in registry
3. Emit `tool_reloaded` event

### Files to Modify
- `src/tools/loader.ts` - Add reload methods
- `src/tools/index.ts` - Add reload API
- `src/squire.ts` - Integrate file watcher

---

## Phase 4: Tool Registry (Discovery)

### Goal
Centralized place to discover and share tools.

### Options

#### Option A: GitHub Topics
Tools published with topic `squire-tool`:
```
https://github.com/search?q=topic:squire-tool
```

#### Option B: Dedicated Registry Repo
Single repo with tool index:
```
https://github.com/squire-ai/tool-registry
```

Structure:
```
registry/
├── index.json          # Tool index
├── categories/
│   ├── discord.json
│   ├── productivity.json
│   └── development.json
└── tools/
    └── {tool-name}.json  # Detailed metadata
```

#### Option C: QMD-Powered Search
Index all published tools in QMD for semantic search.

### New Tool: `tool_registry_search`
```typescript
{
  name: "tool_registry_search",
  input: {
    query: "image processing",
    category: "optional",
    limit: 10
  }
}
```

---

## Phase 5: Discord Bot Hooks for Tools

### Goal
Tools can hook into Discord bot lifecycle.

### Hook Types

```typescript
type DiscordHook =
  | 'on_message'           // Any message
  | 'on_command'           // ! commands
  | 'on_reaction'          // Reaction added
  | 'on_member_join'       // New member
  | 'on_member_leave'      // Member left
  | 'on_channel_create'    // Channel created
  | 'on_voice_join'        // Voice channel join
  | 'on_voice_leave'       // Voice channel leave
  | 'on_thread_create'     // Forum thread created
  | 'scheduled'            // Cron-based
```

### Tool Manifest Extension

```yaml
# tool.md
metadata:
  squire:
    discord:
      hooks:
        - event: on_member_join
          handler: welcome_member
        - event: scheduled
          cron: "0 9 * * *"
          handler: daily_summary
```

### Hook Handler Signature

```typescript
type HookHandler = (
  event: DiscordEvent,
  context: ToolHandlerContext
) => Promise<void | { respond: boolean }>
```

---

## Implementation Priority

### Phase 1: Tool Publishing (Week 1)
- [ ] Create `tool_publish` bundled tool
- [ ] Add GitHub API integration
- [ ] Test with sample tool

### Phase 2: Discord Extensions (Week 2)
- [ ] Design extension registry
- [ ] Create `discord_create_channel`
- [ ] Create `discord_send_announcement`
- [ ] Create `discord_create_command`
- [ ] Integrate with squire-bot

### Phase 3: Dynamic Loading (Week 3)
- [ ] Add reload methods to loader
- [ ] Implement file watcher
- [ ] Test hot reload

### Phase 4: Tool Registry (Week 4)
- [ ] Choose registry approach
- [ ] Create `tool_registry_search`
- [ ] Set up GitHub topic or repo

### Phase 5: Bot Hooks (Week 5)
- [ ] Design hook system
- [ ] Implement event dispatcher
- [ ] Create example tools with hooks

---

## Example: Announcement Tool (Full Flow)

### 1. Create the Tool
```typescript
// AI calls tool_create
{
  name: "announcement-system",
  description: "Manage announcements with subscriptions",
  inputProperties: {
    action: { type: "string", enum: ["create", "subscribe", "announce"] },
    title: { type: "string" },
    message: { type: "string" }
  },
  requiredInputs: ["action"],
  destination: "global"
}
```

### 2. Extend for Discord
```typescript
// AI modifies tool.md to add:
metadata:
  squire:
    discord:
      commands:
        - name: "announce"
          description: "Post announcement"
      channels:
        - type: "announcement"
          name: "announcements"
```

### 3. Publish to GitHub
```typescript
// AI calls tool_publish
{
  toolName: "announcement-system",
  description: "Squire announcement system with Discord integration"
}
// Returns: https://github.com/user/squire-tool-announcement-system
```

### 4. Others Install
```typescript
// Another user's Squire calls tool_install
{
  repository: "https://github.com/user/squire-tool-announcement-system",
  destination: "global"
}
```

---

## Questions to Resolve

1. **GitHub Authentication**: Store token in config or env?
2. **Discord Permissions**: How to handle permission requirements for tools?
3. **Tool Sandboxing**: Should tools run in isolated contexts?
4. **Version Compatibility**: How to handle breaking changes in tool API?
5. **Multi-bot Support**: Can multiple Squire instances share tools?

---

## Success Metrics

- Squire can create, publish, and install tools autonomously
- Tools can extend Discord without core changes
- Hot reload works for development
- Registry enables tool discovery
- > 10 community tools published
