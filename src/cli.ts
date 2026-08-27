#!/usr/bin/env node
/**
 * Squire CLI
 *
 * Command-line interface for Squire personal AI assistant.
 * By default, starts the Discord bot.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Squire, createSquire } from './squire.js';
import { loadConfig, saveConfig, createDefaultConfig, initConfig, getConfigPath } from './config.js';
import type { SquireConfig } from './types.js';
import { runOnboarding, needsOnboarding } from './cli/onboarding.js';
import {
  showPersonality,
  listPersonalities,
  setPersonality,
  buildPersonality,
  setWorkspacePersonality,
  clearWorkspacePersonality,
} from './cli/personality.js';
import {
  listTools,
  searchTools,
  installTool,
  createTool,
} from './cli/tools.js';

const VERSION = '0.1.0';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'start';

interface CLIOptions {
  help?: boolean;
  version?: boolean;
  provider?: 'claude' | 'gemini' | 'codex';
  model?: string;
}

function parseOptions(args: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--provider' || arg === '-p') {
      options.provider = args[++i] as 'claude' | 'gemini' | 'codex';
    } else if (arg === '--model' || arg === '-m') {
      options.model = args[++i];
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Squire - Personal AI Assistant

Usage:
  squire [command] [options]

Commands:
  start                   Start the Discord bot (default)
  repl                    Start interactive REPL mode (debug)
  init                    Interactive setup wizard
  config                  Manage configuration

  personality commands:
    personality show      Show current personality
    personality list      List available templates
    personality set <name>      Set personality from template
    personality build     Build custom personality interactively

  tools commands:
    tools list            List installed tools
    tools search [query]  Search for tools
    tools install <repo>  Install a tool from git
    tools create [name]   Create a new tool

Options:
  -h, --help      Show this help message
  -v, --version   Show version
  -p, --provider  SDK provider (claude, gemini, codex)
  -m, --model     Model to use
  --non-interactive   Skip interactive prompts

Examples:
  squire                           # Start Discord bot
  squire start                     # Same as above
  squire init                      # Interactive setup wizard
  squire repl                      # Interactive CLI mode
  squire personality set helpful   # Set personality
  squire tools search image        # Search for image tools
`);
}

function printVersion(): void {
  console.log(`Squire v${VERSION}`);
}

/**
 * Start the Discord bot by spawning squire-bot
 */
async function startBot(): Promise<void> {
  console.log('Starting Squire Discord bot...');

  const botPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bot.js');

  const bot = spawn(process.execPath, [botPath], {
    stdio: 'inherit',
    env: process.env,
  });

  bot.on('error', (error) => {
    console.error('Failed to start Discord bot:', error);
    process.exit(1);
  });

  bot.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Discord bot exited with code ${code}`);
    }
    process.exit(code || 0);
  });

  // Handle shutdown signals
  process.on('SIGINT', () => {
    bot.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    bot.kill('SIGTERM');
  });
}

/**
 * Start REPL mode (for debugging/testing without Discord)
 */
async function runREPL(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\nSquire REPL - Debug mode (no Discord)');
  console.log('Type "exit" to quit\n');

  // Load or create config
  let config = loadConfig();
  if (!config) {
    console.log('No configuration found. Creating default...');
    config = createDefaultConfig();
    saveConfig(config);
  }

  // Create and start Squire
  const squire = createSquire(config);

  // Create default workspace
  const workspace = await squire.createWorkspace({
    name: 'default',
    source: 'cli',
    sourceId: 'repl',
  });

  // Handle events from Squire
  squire.on('communication', (data) => {
    if (data.type === 'text') {
      console.log(`\n[Squire] ${data.content}`);
    } else if (data.type === 'embed') {
      console.log(`\n[Squire] ${data.title}: ${data.content}`);
    }
  });

  squire.on('status', (data) => {
    process.stdout.write(`\r[${data.activity}...]`);
  });

  squire.on('approval_required', async (data) => {
    console.log(`\n⚠️  Approval required: ${data.toolName}`);
    console.log(`Reason: ${data.reason}`);

    const answer = await new Promise<string>((resolve) => {
      rl.question('Approve? [y/N] ', resolve);
    });

    await squire.respondToApproval(data.requestId, answer.toLowerCase() === 'y');
  });

  await squire.start();

  const prompt = () => {
    rl.question('\n> ', async (input) => {
      const trimmed = input.trim();

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('Goodbye!');
        rl.close();
        await squire.stop();
        process.exit(0);
        return;
      }

      if (trimmed === 'status') {
        const status = squire.getStatus();
        console.log(`\nStatus: ${status.activity}`);
        prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        const [cmd, ...rest] = trimmed.slice(1).split(' ');

        if (cmd === 'help') {
          console.log('\nCommands: /help, /status, /sdk <provider>, exit');
        } else if (cmd === 'status') {
          const status = squire.getStatus();
          console.log(`\nStatus: ${status.activity}`);
        } else if (cmd === 'sdk' && rest[0]) {
          await squire.switchSDK(rest[0] as 'claude' | 'gemini' | 'codex');
          console.log(`\nSwitched to ${rest[0]} SDK`);
        }

        prompt();
        return;
      }

      if (trimmed) {
        try {
          await squire.sendMessage(workspace.workspaceId, trimmed);
        } catch (error) {
          console.error('Error:', error);
        }
      }

      prompt();
    });
  };

  prompt();
}

async function handleConfig(subcommand: string): Promise<void> {
  const config = loadConfig();

  if (subcommand === 'show' || !subcommand) {
    if (config) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log('No configuration found. Run "squire init" to create one.');
    }
  } else if (subcommand === 'path') {
    console.log(getConfigPath());
  } else if (subcommand === 'reset') {
    const newConfig = createDefaultConfig();
    saveConfig(newConfig);
    console.log('Configuration reset to defaults');
  } else {
    console.error(`Unknown config subcommand: ${subcommand}`);
    console.log('Available: show, path, reset');
  }
}

async function main(): Promise<void> {
  const options = parseOptions(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  // Handle personality commands
  if (command === 'personality') {
    const subcommand = args[1];
    switch (subcommand) {
      case 'show':
        await showPersonality();
        break;
      case 'list':
        await listPersonalities();
        break;
      case 'set':
        await setPersonality(args[2]);
        break;
      case 'build':
        await buildPersonality();
        break;
      case 'workspace':
        if (args[2] === 'clear') {
          await clearWorkspacePersonality(args[3]);
        } else {
          await setWorkspacePersonality(args[2], args[3]);
        }
        break;
      default:
        console.log('Usage: squire personality [show|list|set|build|workspace]');
    }
    process.exit(0);
  }

  // Handle tools commands
  if (command === 'tools') {
    const subcommand = args[1];
    switch (subcommand) {
      case 'list':
        await listTools();
        break;
      case 'search':
        await searchTools(args[2]);
        break;
      case 'install':
        await installTool(args[2], args[3] as 'global' | 'project');
        break;
      case 'create':
        await createTool(args[2], args[3]);
        break;
      default:
        console.log('Usage: squire tools [list|search|install|create]');
    }
    process.exit(0);
  }

  // Handle config command
  if (command === 'config') {
    await handleConfig(args[1]);
    process.exit(0);
  }

  // Handle init command - run onboarding wizard
  if (command === 'init') {
    await runOnboarding({
      sdkProvider: options.provider,
    });
    process.exit(0);
  }

  // Handle start command (default) - start Discord bot
  if (command === 'start') {
    // Check if first-time setup is needed
    if (await needsOnboarding()) {
      console.log('First time? Running setup wizard...\n');
      await runOnboarding();
      console.log('\nNow starting Squire...\n');
    }
    await startBot();
    return;
  }

  // Handle repl command
  if (command === 'repl') {
    await runREPL();
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
