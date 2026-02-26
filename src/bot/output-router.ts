export interface OutputRouterCommunicator {
  checkOutputTypeChange(workspaceId: string, newType: string): boolean;
  hasStreamingMessage(workspaceId: string): boolean;
  clearStreamingState(workspaceId: string): void;
  sendText(workspaceId: string, content: string, isComplete?: boolean): Promise<void>;
}

export interface SquireOutputEventData {
  workspaceId?: string;
  content: string;
  outputType: string;
  isComplete: boolean;
}

export function sanitizeAssistantStdout(content: string): string {
  return content.trim();
}

export class DiscordOutputRouter {
  private debugEnabled = process.env.SQUIRE_DEBUG_STREAMING === '1';
  private lastStdoutSeen = new Map<string, string>();
  private streamPrefixToStrip = new Map<string, string>();
  private routeQueues = new Map<string, Promise<void>>();
  private inThinkingSegment = new Map<string, boolean>();

  constructor(private communicator: OutputRouterCommunicator) {}

  private debug(message: string): void {
    if (!this.debugEnabled) return;
    console.log(`[StreamDebug][Router] ${message}`);
  }

  private enqueueWorkspace(workspaceId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.routeQueues.get(workspaceId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const settled = run
      .catch(() => undefined)
      .finally(() => {
        if (this.routeQueues.get(workspaceId) === settled) {
          this.routeQueues.delete(workspaceId);
        }
      });
    this.routeQueues.set(workspaceId, settled);
    return run;
  }

  private getCommonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) {
      i += 1;
    }
    return i;
  }

  private trimLeadingWhitespace(content: string): { value: string; removed: number } {
    const trimmed = content.replace(/^\s+/, '');
    return { value: trimmed, removed: content.length - trimmed.length };
  }

  private isWordLikeChar(char: string): boolean {
    return /[A-Za-z0-9]/.test(char);
  }

  private isBoundaryChar(char: string): boolean {
    return /\s|[.,!?;:()[\]{}"“”`]/.test(char);
  }

  private adjustStartToWordBoundary(content: string, startIndex: number): number {
    if (startIndex <= 0 || startIndex >= content.length) return startIndex;

    const prev = content[startIndex - 1];
    const curr = content[startIndex];
    if (!prev || !curr) return startIndex;

    const likelySplitWithinToken =
      (this.isWordLikeChar(prev) && this.isWordLikeChar(curr)) ||
      (this.isWordLikeChar(prev) && curr === '\'') ||
      (prev === '\'' && this.isWordLikeChar(curr));

    if (!likelySplitWithinToken) return startIndex;

    let i = startIndex;
    while (i > 0) {
      const c = content[i - 1];
      if (this.isBoundaryChar(c)) break;
      i -= 1;
    }
    return i;
  }

  private trimToStructuredBoundary(content: string): { value: string; removed: number } {
    const patterns = [
      /\n\n(?=\*\*Message\s+\d+:)/,
      /\n\n(?=Message\s+\d+:)/,
      /\n\n(?=\d+\.\s)/,
      /\n\n(?=[A-Z][^:\n]{1,40}:)/,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match && match.index >= 0 && match.index <= 140) {
        const start = match.index + 2;
        const slice = content.slice(start);
        const trimmed = this.trimLeadingWhitespace(slice);
        return {
          value: trimmed.value,
          removed: start + trimmed.removed,
        };
      }
    }
    return { value: content, removed: 0 };
  }

  async handleOutput(data: SquireOutputEventData): Promise<void> {
    const workspaceId = data.workspaceId;
    if (!workspaceId) return;

    return this.enqueueWorkspace(workspaceId, () => this.handleOutputSerial(data));
  }

  private async handleOutputSerial(data: SquireOutputEventData): Promise<void> {
    const workspaceId = data.workspaceId;
    if (!workspaceId) return;

    if (data.outputType !== 'stdout') {
      if (data.outputType === 'thinking') {
        const inThinking = this.inThinkingSegment.get(workspaceId) === true;
        const hasStream = this.communicator.hasStreamingMessage(workspaceId);
        if (hasStream && !inThinking) {
          this.debug(`thinking boundary clear streaming workspace=${workspaceId.slice(0, 8)}`);
          this.communicator.clearStreamingState(workspaceId);
          this.streamPrefixToStrip.delete(workspaceId);
        }
        if (data.isComplete) {
          this.inThinkingSegment.delete(workspaceId);
        } else {
          this.inThinkingSegment.set(workspaceId, true);
        }
      }
      return;
    }

    // Exiting thinking segment once stdout resumes.
    this.inThinkingSegment.delete(workspaceId);

    const typeChanged = this.communicator.checkOutputTypeChange(workspaceId, data.outputType);
    if (typeChanged) {
      this.streamPrefixToStrip.delete(workspaceId);
    }
    this.debug(`stdout workspace=${workspaceId.slice(0, 8)} complete=${data.isComplete} len=${data.content.length} typeChanged=${typeChanged}`);

    const cleanContent = sanitizeAssistantStdout(data.content);
    if (!cleanContent) {
      this.debug(`cleaned stdout empty`);
      if (data.isComplete && this.communicator.hasStreamingMessage(workspaceId)) {
        this.debug(`clearing streaming state after empty complete`);
        this.communicator.clearStreamingState(workspaceId);
      }
      if (data.isComplete) {
        this.lastStdoutSeen.delete(workspaceId);
        this.streamPrefixToStrip.delete(workspaceId);
      }
      return;
    }

    const hasStream = this.communicator.hasStreamingMessage(workspaceId);
    const previousStdout = this.lastStdoutSeen.get(workspaceId);
    const activePrefix = this.streamPrefixToStrip.get(workspaceId);
    let contentToSend = cleanContent;
    let decision = 'send_full';
    let contentStartIndex = 0;

    if (hasStream && activePrefix && cleanContent.startsWith(activePrefix)) {
      contentStartIndex = activePrefix.length;
      contentToSend = cleanContent.slice(contentStartIndex);
      decision = 'send_stream_with_prefix_strip';
    }

    // If we are starting a fresh Discord message and stdout is accumulated from a prior
    // assistant segment, send only the new suffix to avoid duplicated text blocks.
    if (!hasStream && previousStdout && cleanContent.startsWith(previousStdout)) {
      contentStartIndex = previousStdout.length;
      contentStartIndex = this.adjustStartToWordBoundary(cleanContent, contentStartIndex);
      const trimmed = this.trimLeadingWhitespace(cleanContent.slice(contentStartIndex));
      contentStartIndex += trimmed.removed;
      contentToSend = trimmed.value;
      decision = 'send_suffix_exact_prefix';
      this.debug(`stdout continuation detected prevLen=${previousStdout.length} fullLen=${cleanContent.length} sendLen=${contentToSend.length}`);
    } else if (!hasStream && previousStdout) {
      const commonPrefixLen = this.getCommonPrefixLength(previousStdout, cleanContent);
      const overlapThreshold = Math.max(40, Math.floor(previousStdout.length * 0.5));
      if (commonPrefixLen >= overlapThreshold) {
        contentStartIndex = commonPrefixLen;
        contentStartIndex = this.adjustStartToWordBoundary(cleanContent, contentStartIndex);
        const trimmed = this.trimLeadingWhitespace(cleanContent.slice(contentStartIndex));
        contentStartIndex += trimmed.removed;
        contentToSend = trimmed.value;
        decision = 'send_suffix_common_prefix';
        this.debug(`stdout continuation (prefix overlap) prevLen=${previousStdout.length} fullLen=${cleanContent.length} commonPrefix=${commonPrefixLen} sendLen=${contentToSend.length}`);
      }
    }

    this.lastStdoutSeen.set(workspaceId, cleanContent);

    if (!hasStream && (decision === 'send_suffix_exact_prefix' || decision === 'send_suffix_common_prefix')) {
      const structured = this.trimToStructuredBoundary(contentToSend);
      if (structured.value !== contentToSend) {
        this.debug(`trimmed continuation to structured boundary fromLen=${contentToSend.length} toLen=${structured.value.length}`);
        contentStartIndex += structured.removed;
        contentToSend = structured.value;
        decision = `${decision}_trimmed`;
      }
    }

    if (contentStartIndex > 0 && contentStartIndex <= cleanContent.length) {
      this.streamPrefixToStrip.set(workspaceId, cleanContent.slice(0, contentStartIndex));
    } else {
      this.streamPrefixToStrip.delete(workspaceId);
    }

    if (!contentToSend) {
      this.debug(`stdout continuation had no new suffix; skip send`);
      if (data.isComplete) {
        this.lastStdoutSeen.delete(workspaceId);
        this.streamPrefixToStrip.delete(workspaceId);
      }
      return;
    }

    this.debug(`sendText decision=${decision} len=${contentToSend.length} complete=${data.isComplete}`);
    await this.communicator.sendText(workspaceId, contentToSend, data.isComplete);

    if (data.isComplete) {
      this.lastStdoutSeen.delete(workspaceId);
      this.streamPrefixToStrip.delete(workspaceId);
      this.inThinkingSegment.delete(workspaceId);
    }
  }

  handleToolUse(workspaceId?: string): void {
    if (workspaceId) {
      void this.enqueueWorkspace(workspaceId, async () => {
        this.debug(`tool_use clear streaming workspace=${workspaceId.slice(0, 8)}`);
        this.communicator.clearStreamingState(workspaceId);
        this.streamPrefixToStrip.delete(workspaceId);
        this.inThinkingSegment.delete(workspaceId);
      });
    }
  }

  handleComplete(workspaceId?: string): void {
    if (workspaceId) {
      void this.enqueueWorkspace(workspaceId, async () => {
        this.debug(`complete workspace=${workspaceId.slice(0, 8)} (defer stream clear)`);
        this.inThinkingSegment.delete(workspaceId);
      });
    }
  }

  handleApprovalRequired(workspaceId?: string): void {
    if (workspaceId) {
      void this.enqueueWorkspace(workspaceId, async () => {
        this.debug(`approval_required clear streaming workspace=${workspaceId.slice(0, 8)}`);
        this.communicator.clearStreamingState(workspaceId);
        this.streamPrefixToStrip.delete(workspaceId);
        this.inThinkingSegment.delete(workspaceId);
      });
    }
  }

  resetWorkspace(workspaceId?: string): void {
    if (!workspaceId) return;
    this.debug(`reset workspace state workspace=${workspaceId.slice(0, 8)}`);
    this.lastStdoutSeen.delete(workspaceId);
    this.streamPrefixToStrip.delete(workspaceId);
    this.inThinkingSegment.delete(workspaceId);
  }
}
