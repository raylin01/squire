import {
  AttachmentBuilder,
  EmbedBuilder,
  type Client,
  type DMChannel,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';

export type WorkspaceChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Discord message sender for Squire communication.
 */
export class DiscordCommunicator {
  private client: Client;
  private debugEnabled = process.env.SQUIRE_DEBUG_STREAMING === '1';
  private channelMap = new Map<string, WorkspaceChannel>(); // workspaceId -> channel
  private typingIntervals = new Map<string, NodeJS.Timeout>(); // workspaceId -> interval
  private streamingMessages = new Map<string, Message>(); // workspaceId -> current streaming message
  private lastStreamContent = new Map<string, string>(); // workspaceId -> last sent content (for dedup)
  private lastOutputType = new Map<string, string>(); // workspaceId -> last output type (stdout, thinking, tool)
  private streamGenerations = new Map<string, number>(); // workspaceId -> stream state generation

  constructor(client: Client) {
    this.client = client;
  }

  private debug(message: string): void {
    if (!this.debugEnabled) return;
    console.log(`[StreamDebug][Comm] ${message}`);
  }

  private getGeneration(workspaceId: string): number {
    return this.streamGenerations.get(workspaceId) || 0;
  }

  private bumpGeneration(workspaceId: string): number {
    const next = this.getGeneration(workspaceId) + 1;
    this.streamGenerations.set(workspaceId, next);
    return next;
  }

  /**
   * Restore channel mappings from saved workspaces
   */
  async restoreChannels(workspaces: Array<{ workspaceId: string; sourceId?: string }>): Promise<void> {
    for (const workspace of workspaces) {
      if (workspace.sourceId) {
        try {
          const channel = await this.client.channels.fetch(workspace.sourceId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            this.channelMap.set(workspace.workspaceId, channel as WorkspaceChannel);
            console.log(`[Communicator] Restored channel for workspace ${workspace.workspaceId}`);
          }
        } catch (error) {
          console.warn(`[Communicator] Could not restore channel ${workspace.sourceId}:`, error);
        }
      }
    }
  }

  /**
   * Register a channel for a workspace
   */
  registerChannel(workspaceId: string, channel: WorkspaceChannel): void {
    this.channelMap.set(workspaceId, channel);
  }

  /**
   * Get channel for a workspace
   */
  getChannel(workspaceId: string): WorkspaceChannel | undefined {
    return this.channelMap.get(workspaceId);
  }

  hasStreamingMessage(workspaceId: string): boolean {
    return this.streamingMessages.has(workspaceId);
  }

  /**
   * Start typing indicator for a workspace (shows "X is typing...")
   * Discord typing indicator lasts 10 seconds, so we repeat every 8 seconds
   */
  startTyping(workspaceId: string): void {
    const channel = this.channelMap.get(workspaceId);
    if (!channel || !('sendTyping' in channel)) return;

    // Don't start if already typing
    if (this.typingIntervals.has(workspaceId)) return;

    // Send initial typing
    (channel as WorkspaceChannel).sendTyping().catch(() => {});

    // Repeat every 8 seconds (Discord typing lasts 10s)
    const interval = setInterval(() => {
      const ch = this.channelMap.get(workspaceId);
      if (ch && 'sendTyping' in ch) {
        (ch as WorkspaceChannel).sendTyping().catch(() => {});
      }
    }, 8000);

    this.typingIntervals.set(workspaceId, interval);
  }

  /**
   * Stop typing indicator for a workspace
   */
  stopTyping(workspaceId: string): void {
    const interval = this.typingIntervals.get(workspaceId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(workspaceId);
    }
  }

  /**
   * Send a text message to the workspace's Discord channel
   * For streaming: edits existing message if one exists, otherwise creates new
   */
  async sendText(workspaceId: string, content: string, isComplete: boolean = true): Promise<void> {
    const channel = this.channelMap.get(workspaceId);
    if (!channel) {
      console.warn(`[Communicator] No channel for workspace ${workspaceId}`);
      return;
    }
    const generationAtStart = this.getGeneration(workspaceId);

    const chunks = this.splitMessage(content, 2000).filter(chunk => chunk.length > 0);
    if (chunks.length === 0) {
      this.debug(`sendText skip empty workspace=${workspaceId.slice(0, 8)}`);
      return;
    }

    // For streaming: edit existing message or create new
    const existingMessage = this.streamingMessages.get(workspaceId);
    const lastContent = this.lastStreamContent.get(workspaceId);

    // Dedup non-final stream updates
    if (!isComplete && lastContent === content) {
      this.debug(`sendText dedup streaming workspace=${workspaceId.slice(0, 8)} len=${content.length}`);
      return;
    }

    // Duplicate complete event without an active stream can be ignored
    if (isComplete && !existingMessage && lastContent === content) {
      this.debug(`sendText dedup complete workspace=${workspaceId.slice(0, 8)} len=${content.length}`);
      return;
    }

    const firstChunk = chunks[0];

    if (existingMessage) {
      try {
        this.debug(`sendText edit workspace=${workspaceId.slice(0, 8)} len=${firstChunk.length} complete=${isComplete} chunks=${chunks.length}`);
        await existingMessage.edit(firstChunk);
        if (this.getGeneration(workspaceId) !== generationAtStart) {
          this.debug(`sendText edit stale workspace=${workspaceId.slice(0, 8)} startGen=${generationAtStart} currentGen=${this.getGeneration(workspaceId)}; skip state update`);
          return;
        }
        this.lastStreamContent.set(workspaceId, content);

        if (isComplete) {
          for (const chunk of chunks.slice(1)) {
            await channel.send(chunk);
          }
          this.streamingMessages.delete(workspaceId);
          this.lastStreamContent.delete(workspaceId);
        }
        return;
      } catch (error) {
        // If edit fails (message deleted, etc.), clear state and fall through to create new
        console.warn('[Communicator] Failed to edit, creating new:', error);
        this.debug(`sendText edit failed workspace=${workspaceId.slice(0, 8)}; fallback send`);
        this.streamingMessages.delete(workspaceId);
        this.lastStreamContent.delete(workspaceId);
        // Fall through to create new message below
      }
    }

    this.debug(`sendText send new workspace=${workspaceId.slice(0, 8)} len=${firstChunk.length} complete=${isComplete} chunks=${chunks.length}`);
    const message = await channel.send(firstChunk);
    if (this.getGeneration(workspaceId) !== generationAtStart) {
      this.debug(`sendText send stale workspace=${workspaceId.slice(0, 8)} startGen=${generationAtStart} currentGen=${this.getGeneration(workspaceId)}; skip state update`);
      return;
    }
    this.lastStreamContent.set(workspaceId, content);

    // Track for streaming if not complete
    if (!isComplete) {
      this.streamingMessages.set(workspaceId, message as Message);
    } else {
      for (const chunk of chunks.slice(1)) {
        await channel.send(chunk);
      }
      this.streamingMessages.delete(workspaceId);
      this.lastStreamContent.delete(workspaceId);
    }
  }

  /**
   * Clear streaming state for a workspace (call when session changes)
   */
  clearStreamingState(workspaceId: string): void {
    const generation = this.bumpGeneration(workspaceId);
    this.debug(`clearStreamingState workspace=${workspaceId.slice(0, 8)}`);
    this.debug(`generation bumped workspace=${workspaceId.slice(0, 8)} -> ${generation}`);
    this.streamingMessages.delete(workspaceId);
    this.lastStreamContent.delete(workspaceId);
    this.lastOutputType.delete(workspaceId);
  }

  /**
   * Check if output type changed and start a new message if so.
   * Returns true if type changed (caller should start fresh).
   */
  checkOutputTypeChange(workspaceId: string, newType: string): boolean {
    const lastType = this.lastOutputType.get(workspaceId);
    const changed = lastType !== undefined && lastType !== newType;

    if (changed) {
      // Type changed - clear streaming state to start a new message
      this.debug(`type change workspace=${workspaceId.slice(0, 8)} ${lastType} -> ${newType}; clearing stream`);
      const generation = this.bumpGeneration(workspaceId);
      this.debug(`generation bumped workspace=${workspaceId.slice(0, 8)} -> ${generation}`);
      this.streamingMessages.delete(workspaceId);
      this.lastStreamContent.delete(workspaceId);
    }

    // Update the tracked type
    this.lastOutputType.set(workspaceId, newType);
    return changed;
  }

  /**
   * Send an embed to the workspace's Discord channel
   */
  async sendEmbed(
    workspaceId: string,
    title: string,
    description: string,
    color: 'green' | 'red' | 'blue' | 'yellow' | 'orange' | 'purple' = 'blue'
  ): Promise<void> {
    const channel = this.channelMap.get(workspaceId);
    if (!channel) {
      console.warn(`[Communicator] No channel for workspace ${workspaceId}`);
      return;
    }

    const colorMap = {
      green: 0x00ff00,
      red: 0xff0000,
      blue: 0x0088ff,
      yellow: 0xffcc00,
      orange: 0xff8800,
      purple: 0x9900ff,
    };

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description.slice(0, 4096)) // Discord embed description limit
      .setColor(colorMap[color])
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  /**
   * Send a file to the workspace's Discord channel
   */
  async sendFile(
    workspaceId: string,
    filePath: string,
    content?: string
  ): Promise<void> {
    const channel = this.channelMap.get(workspaceId);
    if (!channel) {
      console.warn(`[Communicator] No channel for workspace ${workspaceId}`);
      return;
    }

    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(filePath)) {
      console.error(`[Communicator] File not found: ${filePath}`);
      return;
    }

    const attachment = new AttachmentBuilder(filePath);

    await channel.send({
      content: content || undefined,
      files: [attachment],
    });
  }

  /**
   * Split a message into chunks that fit Discord's limits
   */
  private splitMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      // Try to break at newline or space
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint < 0) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint < 0) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    return chunks;
  }
}
