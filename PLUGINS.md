# Squire Plugin Development Guide

Squire supports plugins that extend its Discord bot functionality. Plugins have full access to the Discord.js client and can respond to events, add commands, and interact with Squire's core systems.

## Quick Start

1. Create a directory in `~/.squirebot/plugins/` with your plugin name
2. Create an `index.js` file with your plugin code
3. Restart the bot or use `!plugins reload <name>` to load your plugin

## Plugin Structure

A plugin is a JavaScript module that exports a `SquirePlugin` object:

```javascript
// ~/.squirebot/plugins/my-plugin/index.js

export default {
  // Required: Plugin identity
  name: 'my-plugin',
  version: '1.0.0',
  description: 'A sample plugin that does something cool',
  author: 'Your Name',

  // Optional: Load priority (lower = loads first)
  priority: 0,

  // Optional: Other plugins this one depends on
  dependencies: [],

  // Lifecycle: Called when plugin is loaded
  async onLoad(context) {
    context.log('Plugin loaded!');
  },

  // Lifecycle: Called when plugin is unloaded
  async onUnload() {
    console.log('Plugin unloaded');
  },

  // Main setup: Called with Discord.js client
  async setup(client, context) {
    // Listen to Discord events
    client.on('messageCreate', async (message) => {
      // Handle messages
    });

    // Register slash commands, reactions, etc.
  }
};
```

## Plugin Context

The `context` object provides access to Squire's systems:

```javascript
{
  // Plugin info
  pluginDir: string,      // Path to plugin directory
  pluginName: string,     // Plugin name

  // Discord client (full access)
  client: Client,         // Discord.js Client instance

  // Squire integration
  squireId: string,       // Bot's Discord user ID
  squireName: string,     // Bot's display name
  squire: Squire,         // Squire instance

  // Module resolution
  require: (name) => any, // Use this to require external modules!

  // Workspace management
  getOrCreateWorkspace: async (channelId, channelName, source) => string,
  registerChannel: (workspaceId, channel) => void,

  // Utilities
  log: (...args) => void,     // Console logging with plugin prefix
  error: (...args) => void,   // Error logging

  // Plugin control
  disablePlugin: async (name) => void,
  enablePlugin: async (name) => void,
  reloadPlugin: async (name) => PluginInfo,

  // State persistence
  getState: (key) => any,     // Get persisted state
  setState: (key, value) => void, // Save state

  // Config access (read-only)
  config: object,

  // Access other plugins
  getPlugin: (name) => SquirePlugin | undefined,
  getPluginState: (name) => PluginState
}
```

## Important: Using External Modules

**Do NOT use `require()` or `import` for Discord.js or other bot dependencies directly.** The plugin runs in its own directory and won't find the bot's node_modules.

Instead, use `context.require()`:

```javascript
export default {
  name: 'my-plugin',
  version: '1.0.0',

  async setup(client, context) {
    // WRONG - This will fail!
    // const { Events } = require('discord.js');

    // RIGHT - Use context.require
    const { Events } = context.require('discord.js');

    // Or just use client directly since it's already provided
    client.on('messageCreate', (message) => {
      // ...
    });
  }
};
```

## Example: Reaction Role Plugin

```javascript
// ~/.squirebot/plugins/reaction-roles/index.js

export default {
  name: 'reaction-roles',
  version: '1.0.0',
  description: 'Assigns roles when users react to messages',

  async onLoad(context) {
    context.log('Reaction roles plugin loaded');

    // Load saved state
    this.roleMappings = context.getState('roleMappings') || {};
  },

  async onUnload() {
    console.log('Reaction roles plugin unloaded');
  },

  async setup(client, context) {
    const { Events } = context.require('discord.js');

    // Listen for reactions
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      // Fetch partial reactions
      if (reaction.partial) {
        await reaction.fetch();
      }

      const messageId = reaction.message.id;
      const emoji = reaction.emoji.name;

      // Check if this message+emoji has a role mapping
      const mapping = this.roleMappings[`${messageId}:${emoji}`];
      if (!mapping) return;

      // Assign the role
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(mapping.roleId);

      if (role && member) {
        await member.roles.add(role);
        context.log(`Assigned role ${role.name} to ${user.username}`);
      }
    });
  }
};
```

## Example: Auto-Thread Plugin

```javascript
// ~/.squirebot/plugins/auto-thread/index.js

export default {
  name: 'auto-thread',
  version: '1.0.0',
  description: 'Automatically creates threads for messages in specific channels',

  async setup(client, context) {
    const { ChannelType } = context.require('discord.js');

    // Channels to auto-thread (get from config or state)
    const channelIds = context.config.autoThread?.channels || [];

    client.on('messageCreate', async (message) => {
      // Skip if not in target channels
      if (!channelIds.includes(message.channel.id)) return;

      // Skip bot messages
      if (message.author.bot) return;

      // Skip if already in a thread
      if (message.channel.type === ChannelType.PublicThread) return;

      // Create thread
      const thread = await message.startThread({
        name: `Discussion: ${message.content.slice(0, 50)}...`,
        autoArchiveDuration: 60,
      });

      context.log(`Created thread ${thread.name}`);
    });
  }
};
```

## Hot Reloading

Plugins can be reloaded without restarting the bot:

```bash
# In Discord
!plugins reload my-plugin    # Reload specific plugin
!plugins reload all          # Reload all plugins
```

## Plugin Management Commands

| Command | Description |
|---------|-------------|
| `!plugins` | List all plugins with status |
| `!plugins reload <name>` | Hot reload a plugin |
| `!plugins reload all` | Reload all plugins |
| `!plugins enable <name>` | Enable a disabled plugin |
| `!plugins disable <name>` | Disable a plugin |

## Plugin Configuration

Plugins can read the bot's configuration via `context.config`. To add plugin-specific config, edit your `~/.squirebot/config.yml`:

```yaml
# ~/.squirebot/config.yml

# Plugin-specific settings
autoThread:
  channels:
    - "123456789012345678"
    - "987654321098765432"
```

## Best Practices

1. **Handle errors gracefully** - Wrap async operations in try/catch
2. **Clean up in onUnload** - Remove event listeners, clear timers
3. **Use context.log** - Logs will be prefixed with your plugin name
4. **Store state with context.setState** - State persists across reloads
5. **Don't block the event loop** - Use async operations for heavy work
6. **Check permissions** - Verify the bot has necessary Discord permissions

## Troubleshooting

### "Cannot find module 'discord.js'"

Use `context.require('discord.js')` instead of `require()` or `import`.

### Plugin not loading

1. Check the file is named `index.js` or `plugin.js`
2. Check for syntax errors in the console
3. Verify the plugin exports a default object with `name` and `version`

### Changes not taking effect

Use `!plugins reload <name>` to hot reload the plugin without restarting the bot.
