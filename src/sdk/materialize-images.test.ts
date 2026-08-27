import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BaseSDKClient } from './base.js';
import type { SDKMessage, SDKToolResult } from './types.js';

class TextCliClient extends BaseSDKClient {
  readonly provider = 'gemini';

  protected async doSendMessage(): Promise<void> {}
  async sendToolResult(_result: SDKToolResult): Promise<void> {}
  async sendApproval(): Promise<void> {}
  async interrupt(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}

  exposeMaterialize(message: SDKMessage): string {
    return this.materializeMessageForTextCli(message);
  }
}

describe('materializeMessageForTextCli', () => {
  it('writes attached images into cwd and mentions the files in the prompt', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-img-'));
    try {
      const client = new TextCliClient({
        provider: 'gemini',
        cwd,
        permissionMode: 'autoSafe',
      });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
      const text = client.exposeMaterialize({
        role: 'user',
        content: 'Look at this',
        images: [{ data: png, mediaType: 'image/png' }],
      });

      expect(text).toContain('Look at this');
      expect(text).toContain(path.join(cwd, '.squire', 'uploads'));
      const uploads = fs.readdirSync(path.join(cwd, '.squire', 'uploads'));
      expect(uploads.some((name) => name.endsWith('.png'))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
