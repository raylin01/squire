/**
 * Personality CLI Commands
 *
 * Commands for managing Squire personality.
 */

import type { Personality } from '../types.js';
import { loadConfig, saveConfig } from '../config.js';
import { PERSONALITY_TEMPLATES, getPersonalityTemplateList, PersonalityTemplateName } from '../personality/templates.js';
import { buildPersonalityFromAnswers, BUILDER_QUESTIONS } from '../personality/builder.js';
import {
  promptText,
  promptSelect,
  promptConfirm,
  displayHeader,
  displaySubHeader,
  displayInfo,
  displaySuccess,
  displayTable,
} from './prompts.js';

/**
 * Show current personality
 */
export async function showPersonality(): Promise<void> {
  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  displayHeader('Current Personality');

  const personality = config.personality.default;

  displayTable([
    { label: 'Name', value: personality.name },
    { label: 'Description', value: personality.description },
    { label: 'Tone', value: personality.traits.tone },
    { label: 'Verbosity', value: personality.traits.verbosity },
    { label: 'Technicality', value: personality.traits.technicality },
    { label: 'Enthusiasm', value: personality.traits.enthusiasm },
    { label: 'Humor', value: personality.traits.humor },
  ]);

  if (personality.customInstructions) {
    console.log(`\nCustom Instructions:\n${personality.customInstructions}`);
  }

  // Show workspace overrides
  const overrides = config.personality.workspaceOverrides;
  const overrideCount = Object.keys(overrides).length;

  if (overrideCount > 0) {
    console.log(`\nWorkspace Overrides: ${overrideCount}`);
    for (const [workspaceId, override] of Object.entries(overrides)) {
      console.log(`  - ${workspaceId}: ${override.name || 'Partial override'}`);
    }
  }
}

/**
 * List available personality templates
 */
export async function listPersonalities(): Promise<void> {
  displayHeader('Available Personalities');

  const templates = getPersonalityTemplateList();

  for (const template of templates) {
    console.log(`\n${template.displayName} (${template.name})`);
    console.log(`  ${template.description}`);
  }

  console.log('\nUse `squire personality set <name>` to apply a template.');
  console.log('Use `squire personality build` to create a custom personality.\n');
}

/**
 * Set personality from a template
 */
export async function setPersonality(templateName: string): Promise<void> {
  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  const template = PERSONALITY_TEMPLATES[templateName as PersonalityTemplateName];

  if (!template) {
    displayInfo(`Unknown template: ${templateName}`);
    displayInfo('Run `squire personality list` to see available templates.');
    return;
  }

  config.personality.default = { ...template };
  saveConfig(config);

  displaySuccess(`Personality set to "${template.name}"`);
}

/**
 * Build a custom personality interactively
 */
export async function buildPersonality(): Promise<void> {
  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  displayHeader('Build Custom Personality');

  console.log('Answer the following questions to create your custom personality.\n');

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

  const personality = buildPersonalityFromAnswers(answers);

  // Confirm
  console.log('\nGenerated personality:');
  displayTable([
    { label: 'Name', value: personality.name },
    { label: 'Description', value: personality.description },
  ]);

  const confirm = await promptConfirm('\nSave this personality?', true);

  if (confirm) {
    config.personality.default = personality;
    saveConfig(config);
    displaySuccess('Custom personality saved!');
  } else {
    displayInfo('Personality not saved.');
  }
}

/**
 * Set workspace personality override
 */
export async function setWorkspacePersonality(
  workspaceId: string,
  templateName?: string
): Promise<void> {
  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  if (templateName) {
    const template = PERSONALITY_TEMPLATES[templateName as PersonalityTemplateName];

    if (!template) {
      displayInfo(`Unknown template: ${templateName}`);
      return;
    }

    config.personality.workspaceOverrides[workspaceId] = { ...template };
    saveConfig(config);
    displaySuccess(`Workspace ${workspaceId} personality set to "${template.name}"`);
  } else {
    // Interactive selection
    const templates = getPersonalityTemplateList();
    const options = templates.map(t => ({
      value: t.name,
      label: t.displayName,
      description: t.description,
    }));

    const choice = await promptSelect('Select personality for workspace:', options);
    const template = PERSONALITY_TEMPLATES[choice as PersonalityTemplateName];

    if (template) {
      config.personality.workspaceOverrides[workspaceId] = { ...template };
      saveConfig(config);
      displaySuccess(`Workspace ${workspaceId} personality set to "${template.name}"`);
    }
  }
}

/**
 * Clear workspace personality override
 */
export async function clearWorkspacePersonality(workspaceId: string): Promise<void> {
  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  if (config.personality.workspaceOverrides[workspaceId]) {
    delete config.personality.workspaceOverrides[workspaceId];
    saveConfig(config);
    displaySuccess(`Cleared personality override for workspace ${workspaceId}`);
  } else {
    displayInfo(`No override found for workspace ${workspaceId}`);
  }
}
