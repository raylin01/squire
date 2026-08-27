/**
 * AskUserQuestion Handler
 *
 * Handles AskUserQuestion tool calls from Squire by presenting questions
 * in Discord with interactive buttons.
 *
 * Supports:
 * - Single-select questions (one option)
 * - Multi-select questions (multiple options)
 * - Custom "Other" text input
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  Message,
  TextChannel,
  DMChannel,
  ThreadChannel,
  Interaction,
  ButtonInteraction,
} from 'discord.js';
import type { Squire } from '../../index.js';
import {
  ACCESS_DENIED_MESSAGE,
  evaluateDiscordAccess,
} from '../access-control.js';
import type { SquireBotConfig } from '../config.js';

/**
 * Pending question state
 */
interface PendingQuestion {
  requestId: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
  question: string;
  options: Array<{ label: string; value: string }>;
  multiSelect: boolean;
  hasOther: boolean;
  selectedOptions: Set<string>; // For multi-select
  createdAt: Date;
}

// Store pending questions by requestId
const pendingQuestions = new Map<string, PendingQuestion>();
let questionSquire: Squire | null = null;
let questionCleanupTimer: NodeJS.Timeout | null = null;

export function encodeQuestionCustomId(action: string, requestId: string, value?: string): string {
  return value === undefined
    ? `q|${action}|${requestId}`
    : `q|${action}|${requestId}|${value}`;
}

export function parseQuestionCustomId(customId: string): { action: string; requestId: string; value?: string } | null {
  if (customId.startsWith('q|')) {
    const [, action, requestId, ...valueParts] = customId.split('|');
    if (!action || !requestId) {
      return null;
    }
    const value = valueParts.length > 0 ? valueParts.join('|') : undefined;
    return { action, requestId, value };
  }

  if (customId.startsWith('question_')) {
    const parts = customId.split('_');
    const action = parts[1];
    const requestId = parts[2];
    const value = parts.slice(3).join('_') || undefined;
    if (!action || !requestId) {
      return null;
    }
    return { action, requestId, value };
  }

  return null;
}

// Store recently expired questions (requestId -> workspaceId) for resend requests
const expiredQuestions = new Map<string, { workspaceId: string; expiredAt: Date }>();

// Store workspace -> channel mapping for responses
const workspaceChannels = new Map<string, TextChannel | DMChannel | ThreadChannel>();

/**
 * Register a channel for a workspace (called when a message is received)
 */
export function registerQuestionChannel(
  workspaceId: string,
  channel: TextChannel | DMChannel | ThreadChannel
): void {
  workspaceChannels.set(workspaceId, channel);
}

/**
 * Handle approval_required events for AskUserQuestion
 */
export async function handleAskUserQuestion(
  squire: Squire,
  event: {
    requestId: string;
    toolName: string;
    toolInput: Record<string, any>;
    reason?: string;
  },
  workspaceId: string
): Promise<boolean> {
  // Only handle AskUserQuestion
  if (event.toolName !== 'AskUserQuestion') {
    return false;
  }

  const channel = workspaceChannels.get(workspaceId);
  if (!channel) {
    console.error(`[Questions] No channel registered for workspace ${workspaceId}`);
    // Deny the request since we can't present the question
    await squire.respondToApproval(event.requestId, false);
    return true;
  }

  // Extract question data from toolInput
  const toolInput = event.toolInput;
  let question: string;
  let options: Array<{ label: string; value: string }> = [];
  let multiSelect = false;
  let hasOther = true;

  // Parse input - can come in different formats
  if (toolInput.question) {
    question = toolInput.question;
    if (Array.isArray(toolInput.options)) {
      options = toolInput.options.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return { label: opt, value: String(idx + 1) };
        }
        return { label: opt.label || opt.value, value: opt.value || String(idx + 1) };
      });
    }
    multiSelect = toolInput.multiSelect === true;
    hasOther = toolInput.hasOther !== false; // Default true
  } else if (typeof toolInput === 'string') {
    question = toolInput;
  } else {
    console.error('[Questions] Invalid toolInput format:', toolInput);
    await squire.respondToApproval(event.requestId, false);
    return true;
  }

  console.log(`[Questions] Presenting question: "${question.slice(0, 50)}..." (${options.length} options, multiSelect=${multiSelect})`);

  // Create buttons
  const rows = createQuestionButtons(event.requestId, options, multiSelect, hasOther);

  // Create embed
  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // Discord blurple
    .setTitle('Question')
    .setDescription(question)
    .setFooter({ text: multiSelect ? 'Select all that apply, then Submit' : 'Click an option to answer' })
    .setTimestamp();

  // Add options to embed
  if (options.length > 0) {
    const optionsText = options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    embed.addFields({ name: 'Options', value: optionsText });
  }

  // Send message
  const message = await channel.send({
    embeds: [embed],
    components: rows,
  });

  // Store pending question
  const pending: PendingQuestion = {
    requestId: event.requestId,
    workspaceId,
    channelId: channel.id,
    messageId: message.id,
    question,
    options,
    multiSelect,
    hasOther,
    selectedOptions: new Set(),
    createdAt: new Date(),
  };
  pendingQuestions.set(event.requestId, pending);

  return true;
}

/**
 * Create buttons for question options
 */
function createQuestionButtons(
  requestId: string,
  options: Array<{ label: string; value: string }>,
  multiSelect: boolean,
  hasOther: boolean
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (options.length === 0) {
    // No options - just a text response needed
    const otherButton = new ButtonBuilder()
      .setCustomId(encodeQuestionCustomId('other', requestId))
      .setLabel('Type Answer')
      .setStyle(ButtonStyle.Primary);

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(otherButton));
    return rows;
  }

  if (multiSelect) {
    // Multi-select: toggleable buttons + Submit
    const optionButtons = options.map((opt, idx) => {
      return new ButtonBuilder()
        .setCustomId(encodeQuestionCustomId('toggle', requestId, opt.value))
        .setLabel(opt.label.length > 80 ? opt.label.slice(0, 77) + '...' : opt.label)
        .setStyle(ButtonStyle.Secondary);
    });

    // Split into rows of 5
    for (let i = 0; i < optionButtons.length; i += 5) {
      const rowButtons = optionButtons.slice(i, i + 5);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
    }

    // Submit and Other buttons
    const submitButton = new ButtonBuilder()
      .setCustomId(encodeQuestionCustomId('submit', requestId))
      .setLabel('Submit')
      .setStyle(ButtonStyle.Success);

    const actionButtons = [submitButton];

    if (hasOther) {
      const otherButton = new ButtonBuilder()
        .setCustomId(encodeQuestionCustomId('other', requestId))
        .setLabel('Other...')
        .setStyle(ButtonStyle.Primary);
      actionButtons.push(otherButton);
    }

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons));
  } else {
    // Single-select: each button submits immediately
    const optionButtons = options.map((opt) => {
      return new ButtonBuilder()
        .setCustomId(encodeQuestionCustomId('select', requestId, opt.value))
        .setLabel(opt.label.length > 80 ? opt.label.slice(0, 77) + '...' : opt.label)
        .setStyle(ButtonStyle.Primary);
    });

    // Split into rows of 5
    for (let i = 0; i < optionButtons.length; i += 5) {
      const rowButtons = optionButtons.slice(i, i + 5);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
    }

    // Other button in separate row
    if (hasOther) {
      const otherButton = new ButtonBuilder()
        .setCustomId(encodeQuestionCustomId('other', requestId))
        .setLabel('Other...')
        .setStyle(ButtonStyle.Secondary);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(otherButton));
    }
  }

  return rows;
}

/**
 * Set up interaction handlers for question buttons
 */
export function setupQuestionHandlers(
  squire: Squire,
  client: any,
  config: SquireBotConfig
): void {
  questionSquire = squire;
  if (!questionCleanupTimer) {
    questionCleanupTimer = setInterval(() => {
      void cleanupExpiredQuestions();
    }, 60_000);
    questionCleanupTimer.unref();
  }

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const parsed = parseQuestionCustomId(customId);
    if (!parsed) return;

    const access = evaluateDiscordAccess(config, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    if (!access.allowed) {
      console.warn(`[Access] Denied question button from ${interaction.user.id}: ${access.reason}`);
      await interaction.reply({ content: ACCESS_DENIED_MESSAGE, ephemeral: true });
      return;
    }

    const action = parsed.action;
    const requestId = parsed.requestId;
    const value = parsed.value;

    const pending = pendingQuestions.get(requestId);
    if (!pending) {
      // Check if we have an expired reference for resend
      const expired = expiredQuestions.get(requestId);
      if (expired) {
        // Request resend
        await interaction.deferUpdate();
        const requested = await requestQuestionResend(squire, requestId, expired.workspaceId);
        await interaction.editReply({
          content: requested
            ? 'This question expired. I asked the AI to ask it again.'
            : 'This question has expired. Please ask the AI to repeat the question.',
          embeds: [],
          components: [],
        });
      } else {
        await interaction.reply({ content: 'This question has expired.', ephemeral: true });
      }
      return;
    }

    try {
      if (action === 'select') {
        // Single-select: immediately submit
        if (!value) return;
        await interaction.deferUpdate();

        const selectedOption = pending.options.find(o => o.value === value);
        const answer = selectedOption ? selectedOption.label : value;

        await submitAnswer(squire, pending, answer);
        await interaction.editReply({
          content: `Answered: **${answer}**`,
          embeds: [],
          components: [],
        });

      } else if (action === 'toggle') {
        // Multi-select toggle
        if (!value) return;
        await interaction.deferUpdate();

        if (pending.selectedOptions.has(value)) {
          pending.selectedOptions.delete(value);
        } else {
          pending.selectedOptions.add(value);
        }

        // Update button styles to show selection
        const rows = createQuestionButtons(
          requestId,
          pending.options.map(opt => ({
            ...opt,
            // Mark selected
            label: pending.selectedOptions.has(opt.value) ? `✓ ${opt.label}` : opt.label,
          })),
          true,
          pending.hasOther
        );

        await interaction.editReply({ components: rows });

      } else if (action === 'submit') {
        // Multi-select submit
        await interaction.deferUpdate();

        if (pending.selectedOptions.size === 0) {
          await interaction.editReply({
            content: 'Please select at least one option before submitting.',
          });
          return;
        }

        const selectedLabels = pending.options
          .filter(opt => pending.selectedOptions.has(opt.value))
          .map(opt => opt.label);

        await submitAnswer(squire, pending, selectedLabels.join(', '));
        await interaction.editReply({
          content: `Answered: **${selectedLabels.join(', ')}**`,
          embeds: [],
          components: [],
        });

      } else if (action === 'other') {
        // Request custom text input
        await interaction.reply({
          content: 'Please type your answer in the chat:',
          ephemeral: true,
        });

        // Set up message collector
        const channel = interaction.channel;
        if (!channel || !('createMessageCollector' in channel)) return;

        const filter = (msg: Message) => msg.author.id === interaction.user.id;
        const collector = channel.createMessageCollector({ filter, max: 1, time: 60000 });

        collector.on('collect', async (msg: Message) => {
          const answer = msg.content;

          // Delete the user's message to keep channel clean
          try {
            await msg.delete();
          } catch {
            // May not have permission
          }

          await submitAnswer(squire, pending, answer);

          // Update the question message
          try {
            const questionMsg = await channel.messages.fetch(pending.messageId);
            await questionMsg.edit({
              content: `Answered: **${answer}**`,
              embeds: [],
              components: [],
            });
          } catch {
            // Message may have been deleted
          }
        });

        collector.on('end', (_collected: any, reason: string) => {
          if (reason === 'time') {
            interaction.followUp({
              content: 'Time expired. Please click the button again.',
              ephemeral: true,
            }).catch(() => {});
          }
        });
      }
    } catch (error) {
      console.error('[Questions] Error handling interaction:', error);
      try {
        await interaction.reply({
          content: 'An error occurred. Please try again.',
          ephemeral: true,
        });
      } catch {
        // Interaction may have expired
      }
    }
  });

  console.log('[Questions] Handlers initialized');
}

/**
 * Submit answer to Squire
 */
async function submitAnswer(
  squire: Squire,
  pending: PendingQuestion,
  answer: string
): Promise<void> {
  console.log(`[Questions] Submitting answer for ${pending.requestId}: "${answer.slice(0, 50)}..."`);

  // Remove from pending
  pendingQuestions.delete(pending.requestId);

  // Send response to Squire
  // The answer needs to be in the format expected by the tool
  const updatedInput = {
    question: pending.question,
    answers: {
      answer: answer,
    },
  };

  await squire.respondToApproval(pending.requestId, true, pending.workspaceId, updatedInput);
}

/**
 * Clean up expired questions (call periodically)
 */
export async function cleanupExpiredQuestions(): Promise<void> {
  const now = Date.now();
  const expireMs = 5 * 60 * 1000; // 5 minutes
  const expiredKeepMs = 10 * 60 * 1000; // Keep expired refs for 10 minutes

  for (const [requestId, pending] of pendingQuestions) {
    if (now - pending.createdAt.getTime() > expireMs) {
      console.log(`[Questions] Question expired: ${requestId}`);
      expiredQuestions.set(requestId, {
        workspaceId: pending.workspaceId,
        expiredAt: new Date()
      });
      pendingQuestions.delete(requestId);
      if (questionSquire) {
        try {
          await questionSquire.respondToApproval(requestId, false, pending.workspaceId);
        } catch (error) {
          console.warn(`[Questions] Failed to deny expired question ${requestId}: ${error}`);
        }
      }
    }
  }

  // Clean up old expired references
  for (const [requestId, expired] of expiredQuestions) {
    if (now - expired.expiredAt.getTime() > expiredKeepMs) {
      expiredQuestions.delete(requestId);
    }
  }
}

/**
 * Get pending question count (for debugging)
 */
export function getPendingQuestionCount(): number {
  return pendingQuestions.size;
}

/**
 * Request a question to be re-sent by the AI
 * Called when a user clicks an expired button
 */
export async function requestQuestionResend(
  squire: Squire,
  requestId: string,
  workspaceId: string
): Promise<boolean> {
  // First check if we still have the question stored
  const pending = pendingQuestions.get(requestId);
  if (pending) {
    // Question still exists, no need to resend
    return false;
  }

  // Find the channel for this workspace
  const channel = workspaceChannels.get(workspaceId);
  if (!channel) {
    console.error(`[Questions] No channel for workspace ${workspaceId}`);
    return false;
  }

  // Send a message asking the AI to re-ask the question
  try {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffcc00) // Yellow warning
          .setTitle('Question Expired')
          .setDescription('The question UI has expired. Please ask your question again.')
          .setFooter({ text: 'The previous question was not answered in time' })
          .setTimestamp()
      ]
    });

    // Also send to Squire so the AI knows to re-ask
    await squire.sendMessage(workspaceId, '[System: The previous question UI expired. Please ask your question again if you still need an answer.]');

    console.log(`[Questions] Requested resend for ${requestId}`);
    return true;
  } catch (error) {
    console.error('[Questions] Failed to request resend:', error);
    return false;
  }
}
