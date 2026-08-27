import { describe, expect, it } from 'vitest';
import { encodeQuestionCustomId, parseQuestionCustomId } from './questions.js';

describe('question custom ids', () => {
  it('round-trips request ids that contain underscores', () => {
    const customId = encodeQuestionCustomId('select', 'req_with_underscores', 'opt_1');
    expect(parseQuestionCustomId(customId)).toEqual({
      action: 'select',
      requestId: 'req_with_underscores',
      value: 'opt_1',
    });
  });

  it('still parses the legacy underscore format', () => {
    expect(parseQuestionCustomId('question_toggle_req-1_choice')).toEqual({
      action: 'toggle',
      requestId: 'req-1',
      value: 'choice',
    });
  });

  it('keeps pipe characters inside option values', () => {
    const customId = encodeQuestionCustomId('select', 'req', 'a|b');
    expect(parseQuestionCustomId(customId)).toEqual({
      action: 'select',
      requestId: 'req',
      value: 'a|b',
    });
  });
});
