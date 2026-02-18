# Squire Self-Evolving Discord Bot

## Vision
Squire can write, modify, and execute its own Discord.js code to grow capabilities organically. Instead of pre-defined tools, Squire crafts actual code that becomes part of itself.

## Architecture: Living Code System

### Core Concept
Squire has a "extensions" directory where it can:
1. **Write new JavaScript/TypeScript files**
2. **Load them dynamically at runtime**
3. **Hook into Discord.js client events**
4. **Register new slash commands**
5. **Create new message handlers**

### Directory Structure

```
~/.squire/
├── config.json
├── data/
├── extensions/              # Self-written code lives here
│   ├── index.ts             # Extension registry (auto-generated)
│   ├── commands/            # Slash commands Squire wrote
│   │   ├── announce.ts
│   │   ├── subscribe.ts
│   │   └── ...
│   ├── handlers/            # Event handlers Squire wrote
│   │   ├── welcome.ts       # Member join handler
│   │   ├── auto-role.ts     # Auto-role on join
│   │   └── ...
│   ├── features/            # Full feature modules
│   │   ├── announcement-system/
│   │   │   ├── index.ts
│   │   │   ├── commands.ts
│   │   │   └── handlers.ts
│   │   └── ...
│   └── lib/                 # Shared utilities Squire wrote
│       ├── channels.ts
│       └── permissions.ts
└── tools/                   # Traditional tools (separate)
```

---

## How It Works

### 1. Extension Loader

The bot loads extensions dynamically:

```typescript
// squire-bot/src/extensions/loader.ts

export class ExtensionLoader {
  private extensionsDir: string;

  async loadAll(): Promise<LoadedExtension[]> {
    // Scan extensions/commands/*.ts
    // Scan extensions/handlers/*.ts
    // Scan extensions/features/*/index.ts
    // Dynamic import each
    // Register with Discord client
  }

  async loadExtension(path: string): Promise<LoadedExtension> {
    // Hot-load a single extension
    // No restart needed
  }

  async unloadExtension(name: string): Promise<void> {
    // Remove handlers and commands
    // Cleanup
  }
}
```

### 2. Extension Interface

```typescript
// Extension contract
interface SquireExtension {
  name: string;
  version: string;
  description: string;

  // Commands this extension adds
  commands?: SlashCommandBuilder[];

  // Event handlers
  handlers?: {
    [event: string]: (...args: any[]) => Promise<void>;
  };

  // Scheduled tasks
  schedules?: {
    cron: string;
    handler: () => Promise<void>;
  }[];

  // Lifecycle
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}
```

### 3. Self-Modification Tools

Squire has tools to write its own code:

#### `extension_create`
```typescript
{
  name: "extension_create",
  input: {
    type: "command|handler|feature",
    name: "announce",
    description: "What this should do",
    // AI generates the code
  }
}
```

#### `extension_modify`
```typescript
{
  name: "extension_modify",
  input: {
    extension: "announce",
    changes: "Add option to ping @everyone"
  }
}
```

#### `extension_remove`
```typescript
{
  name: "extension_remove",
  input: {
    extension: "old-feature"
  }
}
```

---

## Example: Self-Crafted Announcement System

### User Request
> "I want an announcement channel where I can subscribe and get pinged"

### Squire's Process

1. **Plans the feature**:
   ```
   I need to create:
   - A slash command /announce for posting
   - A slash command /subscribe for subscribing
   - A handler to manage subscriptions
   - An announcement channel (if not exists)
   ```

2. **Writes the code**:

   **extensions/features/announcements/index.ts**:
   ```typescript
   import { SlashCommandBuilder, GuildMember } from 'discord.js';
   import type { SquireExtension } from '@squire/bot';

   export default {
     name: 'announcements',
     version: '1.0.0',
     description: 'Announcement system with subscriptions',

     commands: [
       new SlashCommandBuilder()
         .setName('announce')
         .setDescription('Post an announcement')
         .addStringOption(opt => opt
           .setName('message')
           .setDescription('Announcement content')
           .setRequired(true))
         .addBooleanOption(opt => opt
           .setName('ping')
           .setDescription('Ping subscribers')),

       new SlashCommandBuilder()
         .setName('subscribe')
         .setDescription('Subscribe to announcements'),
     ],

     handlers: {
       interactionCreate: async (interaction, context) => {
         if (!interaction.isChatInputCommand()) return;

         if (interaction.commandName === 'announce') {
           const message = interaction.options.getString('message')!;
           const ping = interaction.options.getBoolean('ping') ?? false;

           // Get subscriber role
           const subscriberRole = await context.getRole('announcement-subscriber');

           // Send announcement
           await interaction.channel!.send({
             content: ping ? `<@&${subscriberRole.id}>\n\n${message}` : message
           });

           await interaction.reply({ content: 'Announced!', ephemeral: true });
         }

         if (interaction.commandName === 'subscribe') {
           const member = interaction.member as GuildMember;
           const role = await context.getRole('announcement-subscriber');
           await member.roles.add(role);
           await interaction.reply({ content: 'Subscribed!', ephemeral: true });
         }
       }
     },

     onLoad: async (context) => {
       // Ensure announcement channel exists
       await context.ensureChannel('announcements', {
         type: 'text',
         topic: 'Important announcements'
       });

       // Ensure subscriber role exists
       await context.ensureRole('announcement-subscriber', {
         color: 'Blue',
         mentionable: true
       });
     }
   } satisfies SquireExtension;
   ```

3. **Loads the extension**:
   - Extension saved to disk
   - Loader imports it
   - Commands registered with Discord
   - Handlers attached to client
   - onLoad runs (creates channel + role)

4. **Feature is live!** No restart needed.

---

## Key Components

### 1. Safe Code Execution

Extensions run in the main process but with context injection:

```typescript
interface ExtensionContext {
  // Discord.js client (limited)
  client: {
    user: Client['user'];
    guilds: Client['guilds'];
    channels: Client['channels'];
  };

  // Helper functions (safe)
  getChannel(name: string): Promise<TextChannel | null>;
  ensureChannel(name: string, options): Promise<TextChannel>;
  getRole(name: string): Promise<Role | null>;
  ensureRole(name: string, options): Promise<Role>;
  sendMessage(channel: string, content: string): Promise<Message>;

  // Configuration access (read-only)
  config: {
    squireId: string;
    name: string;
  };

  // Memory access
  memory: {
    remember(content: string, meta?: object): Promise<void>;
    recall(query: string): Promise<MemoryResult[]>;
  };

  // Logging
  log(message: string): void;
  error(message: string, error?: Error): void;
}
```

### 2. Code Templates

Squire uses templates when generating code:

```typescript
// Template for new command
const COMMAND_TEMPLATE = `
import { SlashCommandBuilder } from 'discord.js';
import type { SquireExtension } from '@squire/bot';

export default {
  name: '{{name}}',
  version: '1.0.0',
  description: '{{description}}',

  commands: [
    new SlashCommandBuilder()
      .setName('{{commandName}}')
      .setDescription('{{commandDescription}}')
      // {{#each options}}
      .add{{type}}Option(opt => opt
        .setName('{{name}}')
        .setDescription('{{description}}')
        {{#if required}}.setRequired(true){{/if}})
      // {{/each}}
  ],

  handlers: {
    interactionCreate: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== '{{commandName}}') return;

      // TODO: Implement command logic
      await interaction.reply('Command {{name}} executed!');
    }
  }
} satisfies SquireExtension;
`;
```

### 3. Code Validation

Before loading, validate generated code:

```typescript
async function validateExtension(code: string): Promise<{ valid: boolean; errors: string[] }> {
  // 1. TypeScript compile check
  const tsResult = await compileTypeScript(code);
  if (!tsResult.success) return { valid: false, errors: tsResult.errors };

  // 2. Structure check
  const module = await importFromString(code);
  if (!module.default) return { valid: false, errors: ['Missing default export'] };
  if (!module.default.name) return { valid: false, errors: ['Missing name'] };

  // 3. Safety check
  const dangerousPatterns = [
    /eval\s*\(/,
    /Function\s*\(/,
    /child_process/,
    /fs\.(?:unlink|writeFile)/,
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return { valid: false, errors: [`Unsafe pattern: ${pattern}`] };
    }
  }

  return { valid: true, errors: [] };
}
```

### 4. Rollback System

If an extension crashes, auto-disable it:

```typescript
client.on('error', (error) => {
  const extension = findExtensionForError(error);
  if (extension) {
    console.error(`Extension ${extension.name} caused error, disabling`);
    extensionLoader.unloadExtension(extension.name);
    // Notify user
    sendMessage(`Extension "${extension.name}" was disabled due to an error.`);
  }
});
```

---

## Implementation Plan

### Phase 1: Extension Infrastructure
- [ ] Create `extensions/` directory structure
- [ ] Build `ExtensionLoader` class
- [ ] Define `SquireExtension` interface
- [ ] Integrate loader with squire-bot

### Phase 2: Extension Tools
- [ ] Create `extension_create` tool
- [ ] Create `extension_modify` tool
- [ ] Create `extension_remove` tool
- [ ] Create `extension_list` tool

### Phase 3: Context & Safety
- [ ] Define `ExtensionContext` interface
- [ ] Implement context injection
- [ ] Add code validation
- [ ] Add rollback system

### Phase 4: Templates
- [ ] Create command template
- [ ] Create handler template
- [ ] Create feature template
- [ ] Template selection logic

### Phase 5: Examples
- [ ] Announcement system example
- [ ] Auto-role example
- [ ] Welcome message example
- [ ] Poll system example

---

## Comparison: Tools vs Extensions

| Aspect | Tools (Current) | Extensions (Proposed) |
|--------|----------------|----------------------|
| What they do | Pre-defined actions | Write arbitrary code |
| Flexibility | Limited to tool API | Full Discord.js access |
| AI creates | Tool configs | Actual code |
| Safety | High (sandboxed) | Medium (validated) |
| Power | Moderate | Very high |
| Growth | Add more tools | Bot evolves itself |

---

## Questions

1. **Safety level**: Should extensions be able to do anything Discord.js can, or be limited?

2. **Persistence**: Should extensions be saved to disk and survive restarts?

3. **Sharing**: Should extensions be publishable to GitHub like tools?

4. **Debugging**: How should Squire debug extensions it wrote?

5. **Multi-server**: Should extensions work across all servers or per-server?
