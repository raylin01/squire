/**
 * Test script to understand Gemini SDK streaming behavior
 */

import { GeminiSDKClient } from './src/sdk/gemini.js';

async function main() {
  console.log('=== Testing Gemini SDK Streaming ===\n');

  const client = new GeminiSDKClient({
    cwd: process.cwd(),
    permissionMode: 'autoSafe',
    debug: true,
    model: 'gemini-3.1-pro-preview',
  });

  // Track event counts
  let outputCount = 0;
  let lastContent = '';

  client.on('metadata', (data) => {
    console.log('[METADATA]', data);
  });

  client.on('output', (data) => {
    outputCount++;
    const content = data.content as string;
    const outputType = data.outputType as string;
    const isComplete = data.isComplete as boolean;

    // Show diff indicator
    const isNew = content !== lastContent;
    const indicator = isNew ? '🆕' : '📋';
    const completeIndicator = isComplete ? '✅' : '⏳';

    console.log(`\n[OUTPUT #${outputCount}] type=${outputType} isComplete=${isComplete} ${indicator}${completeIndicator}`);
    console.log(`  Length: ${content.length} chars`);
    if (isNew) {
      console.log(`  Content: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`);
    } else {
      console.log(`  Content: (same as last)`);
    }
    lastContent = content;
  });

  client.on('tool_use', (data) => {
    console.log('\n[TOOL_USE]', data.toolName);
  });

  client.on('approval', (data) => {
    console.log('\n[APPROVAL]', data.toolName);
  });

  client.on('complete', () => {
    console.log('\n[COMPLETE] Session finished');
    console.log(`\nTotal output events: ${outputCount}`);
  });

  client.on('error', (err) => {
    console.error('[ERROR]', err);
  });

  console.log('Starting client...');
  await client.start();
  console.log('Client started!\n');

  // Send a complex prompt that should trigger thinking, output, and tool use
  const prompt = `I want you to test your streaming behavior. Please:

1. First, say "Starting test..."
2. Then think about what 2+2 equals
3. Then say "The answer is 4"
4. Then use the Bash tool to run: echo "tool test"
5. Finally, say "Test complete!"

This will help me understand how your streaming works.`;

  console.log('Sending prompt:', prompt.slice(0, 100) + '...\n');

  await client.sendMessage({ role: 'user', content: prompt });

  // Wait for completion
  await new Promise<void>((resolve) => {
    client.on('complete', () => resolve());
  });

  console.log('\n=== Test Complete ===');
  await client.close();
}

main().catch(console.error);
