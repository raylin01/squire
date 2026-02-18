/**
 * Interactive Prompt Utilities
 *
 * Simple prompt utilities for CLI interactions.
 */

import * as readline from 'readline';

/**
 * Create a readline interface
 */
function createInterface(): readline.ReadLine {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt for text input
 */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  const rl = createInterface();

  const prompt = defaultValue
    ? `${message} [${defaultValue}]: `
    : `${message}: `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt for hidden input (passwords, tokens)
 */
export async function promptPassword(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface();

    // Hide input
    process.stdout.write(`${message}: `);

    // Disable echo
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = '';

    const onData = (char: Buffer) => {
      const c = char.toString('utf8');

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          if (stdin.isTTY) {
            stdin.setRawMode(wasRaw);
          }
          stdin.removeListener('data', onData);
          stdin.pause();
          rl.close();
          process.stdout.write('\n');
          resolve(input);
          break;
        case '\u0003': // Ctrl+C
          process.exit();
          break;
        case '\u007F': // Backspace
          input = input.slice(0, -1);
          break;
        default:
          input += c;
          break;
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

/**
 * Prompt for a single selection from options
 */
export async function promptSelect(
  message: string,
  options: Array<{ value: string; label: string; description?: string }>
): Promise<string> {
  console.log(`\n${message}\n`);

  options.forEach((option, index) => {
    const desc = option.description ? ` - ${option.description}` : '';
    console.log(`  ${index + 1}. ${option.label}${desc}`);
  });

  console.log('');

  const rl = createInterface();

  return new Promise((resolve) => {
    const ask = () => {
      rl.question('Enter choice (number): ', (answer) => {
        const num = parseInt(answer.trim(), 10);

        if (num >= 1 && num <= options.length) {
          rl.close();
          resolve(options[num - 1].value);
        } else {
          console.log(`Invalid choice. Please enter a number between 1 and ${options.length}.`);
          ask();
        }
      });
    };

    ask();
  });
}

/**
 * Prompt for yes/no confirmation
 */
export async function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  const rl = createInterface();

  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const prompt = `${message} ${hint}: `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();

      if (trimmed === '') {
        resolve(defaultValue);
      } else if (trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
      } else if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
      } else {
        resolve(defaultValue);
      }
    });
  });
}

/**
 * Display a section header
 */
export function displayHeader(title: string): void {
  console.log('');
  console.log('═'.repeat(50));
  console.log(`  ${title}`);
  console.log('═'.repeat(50));
  console.log('');
}

/**
 * Display a sub-header
 */
export function displaySubHeader(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
  console.log('');
}

/**
 * Display an info message
 */
export function displayInfo(message: string): void {
  console.log(`ℹ ${message}`);
}

/**
 * Display a success message
 */
export function displaySuccess(message: string): void {
  console.log(`✓ ${message}`);
}

/**
 * Display a warning message
 */
export function displayWarning(message: string): void {
  console.log(`⚠ ${message}`);
}

/**
 * Display an error message
 */
export function displayError(message: string): void {
  console.log(`✗ ${message}`);
}

/**
 * Display a table of key-value pairs
 */
export function displayTable(items: Array<{ label: string; value: string }>): void {
  const maxLabel = Math.max(...items.map(i => i.label.length));

  for (const item of items) {
    const padding = ' '.repeat(maxLabel - item.label.length + 2);
    console.log(`  ${item.label}:${padding}${item.value}`);
  }
}

/**
 * Clear the console
 */
export function clearScreen(): void {
  console.clear();
}
