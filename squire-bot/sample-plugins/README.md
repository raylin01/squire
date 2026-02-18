# Squire Plugin System

Squire can write, load, and manage its own Discord.js plugins. This allows Squire to "grow" its capabilities organically by creating new features without modifying the core bot code.

## Features

- **Direct Discord.js Access** - Plugins have full access to the Discord.js client
- **Safe Mode** - Disable all plugins with `--safe` flag or config option
- **Enable/Disable** - Individual plugins can be enabled or disabled
- **Hot Reload** - Plugins can be reloaded without restarting the bot
- **Priority Loading** - Control load order with `priority` field
- **Dependencies** - Specify required plugins with `dependencies` field

## Plugin Location

Plugins are loaded from:
- Default: `~/.squirebot/plugins/`
- Custom: Set `plugins.pluginsDir` in config

## CLI Flags

```bash
# Start with all plugins disabled
squire-bot --safe

# Alternative flag
squire-bot --safe-mode
```

## Plugin Interface

```typescript
interface SquirePlugin {
  // Identity
  name: string;
  version: string;
  description?: string;
  author?: string;

  // Lifecycle hooks
  onLoad?: (context: PluginContext) => Promise<void> | void;
  onUnload?: () => Promise<void> | void;

  // Discord.js setup
  setup?: (client: Client, context: PluginContext) => Promise<void> | void;

  // Metadata
  enabled?: boolean;      // Default true
  priority?: number;      // Load order (higher = later)
  dependencies?: string[]; // Required plugins
}
```

## Plugin Context

Plugins receive a context with useful utilities:

```typescript
interface PluginContext {
  // Plugin info
  pluginDir: string;
  pluginName: string;

  // Discord client (full access)
  client: Client;

  // Squire info
  squireId: string;
  squireName: string;

  // Logging
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;

  // Plugin control
  disablePlugin: (name: string) => Promise<void>;
  enablePlugin: (name: string) => Promise<void>;

  // Persistent state
  getState: <T = any>(key: string) => T | undefined;
  setState: <T = any>(key: string, value: T) => void;

  // Other plugins
  getPlugin: (name: string) => SquirePlugin | undefined;
  getPluginState: (name: string) => PluginState;
}
```

## Example Plugin

```typescript
// ~/.squirebot/plugins/my-plugin/index.ts

import type { SquirePlugin, PluginContext } from '@squire/bot';
import { Events, EmbedBuilder } from 'discord.js';

export default {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'A simple example plugin',

  async onLoad(context: PluginContext) {
    context.log('Plugin loaded!');
  },

  async setup(client, context) {
    // React to messages
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      if (message.content === '!ping') {
        await message.reply('Pong!');
      }
    });

    context.log('Event handlers registered');
  },

  enabled: true,
} satisfies SquirePlugin;
```

## Sample Plugins

See the `sample-plugins/` directory for complete examples:

1. **welcome-message** - Sends welcome messages to new members
2. **announcement-system** - Full announcement system with subscriptions

## How Squire Creates Plugins

When a user asks for a new feature (e.g., "I want an announcement channel"), Squire can:

1. **Analyze the request** - Understand what Discord.js functionality is needed
2. **Write the plugin** - Generate a complete plugin with:
   - Event handlers (messageCreate, guildMemberAdd, etc.)
   - State management (getState/setState)
   - Error handling
3. **Save to disk** - Write the plugin to `~/.squirebot/plugins/`
4. **Load dynamically** - The plugin becomes active immediately

## Safe Mode

If a plugin causes issues, start the bot in safe mode:

```bash
squire-bot --safe
```

This disables all plugins, allowing you to diagnose issues.

## Plugin State

Plugins can persist state across restarts:

```typescript
// Set state
context.setState('welcomeChannelId', '123456789');
context.setState('config', { enabled: true, message: 'Welcome!' });

// Get state
const channelId = context.getState<string>('welcomeChannelId');
const config = context.getState<{ enabled: boolean }>('config');
```

## Dependencies

If your plugin requires another plugin:

```typescript
export default {
  name: 'advanced-feature',
  dependencies: ['announcement-system'],
  // ...
} satisfies SquirePlugin;
```

If a dependency is not loaded, the plugin will fail to load.

## Priority

Control load order with priority (lower = earlier):

```typescript
export default {
  name: 'core-plugin',
  priority: 0,  // Load first
  // ...
} satisfies SquirePlugin;

export default {
  name: 'feature-plugin',
  priority: 10,  // Load after core-plugin
  // ...
} satisfies SquirePlugin;
```
