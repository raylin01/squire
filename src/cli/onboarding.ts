/**
 * Onboarding Wizard
 *
 * Interactive setup wizard for first-time Squire configuration.
 */

import os from 'os';
import path from 'path';
import type { SquireConfig, SDKProvider, PermissionConfig, Personality } from '../types.js';
import { saveConfig, ensureSquireDir, getSquireDir } from '../config.js';
import { PERSONALITY_TEMPLATES, getPersonalityTemplateList, PersonalityTemplateName } from '../personality/templates.js';
import { buildPersonalityFromAnswers, BUILDER_QUESTIONS, suggestPersonality } from '../personality/builder.js';
import {
  promptText,
  promptPassword,
  promptSelect,
  promptConfirm,
  displayHeader,
  displaySubHeader,
  displayInfo,
  displaySuccess,
  displayWarning,
  displayTable,
} from './prompts.js';

export interface OnboardingOptions {
  nonInteractive?: boolean;
  discordToken?: string;
  discordAppId?: string;
  sdkProvider?: SDKProvider;
  personalityTemplate?: PersonalityTemplateName;
  permissionMode?: PermissionConfig['mode'];
}

export interface OnboardingResult {
  config: SquireConfig;
  discordToken?: string;
  discordAppId?: string;
}

/**
 * Run the interactive onboarding wizard
 */
export async function runOnboarding(options: OnboardingOptions = {}): Promise<OnboardingResult> {
  displayHeader('Welcome to Squire!');

  console.log('This wizard will help you set up your personal AI assistant.\n');

  // Step 1: Discord Setup
  const discordConfig = await setupDiscord(options);

  // Step 2: AI Provider
  const sdkProvider = await setupSDKProvider(options);

  // Step 3: Personality
  const personality = await setupPersonality(options);

  // Step 4: Permissions
  const permissionMode = await setupPermissions(options);

  // Step 5: Summary & Confirmation
  const confirmed = await confirmSetup({
    discordConfig,
    sdkProvider,
    personality,
    permissionMode,
  });

  if (!confirmed) {
    displayWarning('Setup cancelled. Run `squire init` to try again.');
    process.exit(0);
  }

  // Create configuration
  const squireDir = getSquireDir();
  const dataDir = path.join(squireDir, 'data');

  const config: SquireConfig = {
    squireId: `squire-${Date.now()}`,
    name: 'Squire',
    dataDir,
    memoryDbPath: path.join(dataDir, 'memory.db'),
    skillsDir: path.join(dataDir, 'skills'),
    sdk: {
      provider: sdkProvider,
    },
    daemonMode: false,
    pollInterval: 60000,
    memory: {
      enabled: true,
      provider: 'qmd',
      enableReranking: true,
      retentionDays: 90,
    },
    skills: {
      bundled: ['memory', 'web'],
      additional: [],
      autoInstall: true,
    },
    tools: {
      globalDir: path.join(squireDir, 'tools'),
      projectDir: '.squire/tools',
      autoInstall: true,
      searchEnabled: true,
    },
    personality: {
      default: personality,
      workspaceOverrides: {},
    },
    permissions: {
      mode: permissionMode,
      allowedTools: [],
      blockedTools: [],
    },
  };

  // Ensure directories exist
  ensureSquireDir();

  // Save configuration
  saveConfig(config);

  displaySuccess('Configuration saved!');
  displayInfo(`Config location: ${path.join(squireDir, 'config.json')}`);

  console.log('\n🎉 Squire is ready!\n');
  console.log('Next steps:');
  console.log('  1. Run `squire start` to launch Squire');
  if (discordConfig.token) {
    console.log('  2. Invite the bot to your Discord server');
    console.log('  3. Send a message to start chatting!');
  }
  console.log('');

  return {
    config,
    discordToken: discordConfig.token,
    discordAppId: discordConfig.appId,
  };
}

/**
 * Setup Discord integration
 */
async function setupDiscord(options: OnboardingOptions): Promise<{ token?: string; appId?: string }> {
  displaySubHeader('Discord Setup');

  console.log('Squire can connect to Discord for chat-based interactions.\n');

  const setupDiscord = await promptConfirm('Do you want to set up Discord integration?', true);

  if (!setupDiscord) {
    displayInfo('Skipping Discord setup. You can configure it later.');
    return {};
  }

  console.log('\nTo set up Discord, you need:');
  console.log('  1. A Discord Bot Token (from Discord Developer Portal)');
  console.log('  2. Your Discord Application ID\n');

  const token = options.discordToken || await promptPassword('Discord Bot Token');
  const appId = options.discordAppId || await promptText('Discord Application ID');

  return { token, appId };
}

/**
 * Setup AI SDK provider
 */
async function setupSDKProvider(options: OnboardingOptions): Promise<SDKProvider> {
  displaySubHeader('AI Provider');

  if (options.sdkProvider) {
    displayInfo(`Using ${options.sdkProvider} as AI provider.`);
    return options.sdkProvider;
  }

  console.log('Choose your AI provider:\n');

  const provider = await promptSelect('Which AI provider would you like to use?', [
    { value: 'claude', label: 'Claude (Anthropic)', description: 'Recommended for coding and analysis' },
    { value: 'gemini', label: 'Gemini (Google)', description: 'Good for general tasks' },
    { value: 'codex', label: 'Codex (OpenAI)', description: 'Specialized for code' },
  ]);

  return provider as SDKProvider;
}

/**
 * Setup personality
 */
async function setupPersonality(options: OnboardingOptions): Promise<Personality> {
  displaySubHeader('Personality');

  if (options.personalityTemplate) {
    const template = PERSONALITY_TEMPLATES[options.personalityTemplate];
    if (template) {
      displayInfo(`Using "${template.name}" personality.`);
      return template;
    }
  }

  console.log('Choose how Squire should interact with you:\n');

  // Show template options
  const templates = getPersonalityTemplateList();
  const options_list: Array<{ value: string; label: string; description: string }> = templates.map(t => ({
    value: t.name,
    label: t.displayName,
    description: t.description,
  }));

  // Add custom option
  options_list.push({
    value: 'custom',
    label: 'Custom',
    description: 'Build your own personality',
  });

  const choice = await promptSelect('Select a personality style:', options_list);

  if (choice === 'custom') {
    return await buildCustomPersonality();
  }

  return PERSONALITY_TEMPLATES[choice as PersonalityTemplateName];
}

/**
 * Build a custom personality interactively
 */
async function buildCustomPersonality(): Promise<Personality> {
  console.log('\nLet\'s build your custom personality!\n');

  const answers: Record<string, string> = {};

  for (const question of BUILDER_QUESTIONS) {
    if (question.type === 'select' && question.options) {
      const options = question.options.map(o => ({
        value: o.value,
        label: o.label,
        description: o.description,
      }));

      answers[question.id] = await promptSelect(question.question, options);
    } else {
      answers[question.id] = await promptText(question.question);
    }
  }

  return buildPersonalityFromAnswers(answers);
}

/**
 * Setup permissions
 */
async function setupPermissions(options: OnboardingOptions): Promise<PermissionConfig['mode']> {
  displaySubHeader('Permissions');

  if (options.permissionMode) {
    displayInfo(`Using ${options.permissionMode} permission mode.`);
    return options.permissionMode;
  }

  console.log('Choose how Squire should handle potentially dangerous actions:\n');

  const mode = await promptSelect('Permission mode:', [
    {
      value: 'autoSafe',
      label: 'Auto-Safe (Recommended)',
      description: 'Auto-approve safe commands, ask for risky ones',
    },
    {
      value: 'permissive',
      label: 'Permissive',
      description: 'Auto-approve most actions',
    },
    {
      value: 'strict',
      label: 'Strict',
      description: 'Ask for confirmation on most actions',
    },
  ]);

  return mode as PermissionConfig['mode'];
}

/**
 * Confirm setup before saving
 */
async function confirmSetup(details: {
  discordConfig: { token?: string; appId?: string };
  sdkProvider: SDKProvider;
  personality: Personality;
  permissionMode: PermissionConfig['mode'];
}): Promise<boolean> {
  displaySubHeader('Summary');

  const items = [
    { label: 'AI Provider', value: details.sdkProvider },
    { label: 'Personality', value: details.personality.name },
    { label: 'Permission Mode', value: details.permissionMode },
    { label: 'Discord', value: details.discordConfig.token ? 'Enabled' : 'Disabled' },
  ];

  displayTable(items);

  console.log('');
  return promptConfirm('Create configuration with these settings?', true);
}

/**
 * Check if first-time setup is needed
 */
export async function needsOnboarding(): Promise<boolean> {
  const squireDir = getSquireDir();
  const configPath = path.join(squireDir, 'config.json');

  try {
    const fs = await import('fs');
    return !fs.existsSync(configPath);
  } catch {
    return true;
  }
}
