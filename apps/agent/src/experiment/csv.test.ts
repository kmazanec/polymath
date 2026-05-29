import { describe, expect, it } from 'vitest';
import { buildCsv, CSV_COLUMNS, fractionCorrect, type SubjectCsvRow } from './csv.js';

describe('CSV column shape (FROZEN — F-21 reads it)', () => {
  it('header is the exact 9-column order', () => {
    expect(CSV_COLUMNS.join(',')).toBe(
      'subject_id,condition_order,pre_test_score,polymath_session_id,polymath_post_score,baseline_session_id,baseline_post_score,followup_score,qualitative_notes',
    );
  });
});

describe('fractionCorrect', () => {
  it('is null for an empty (not-run) phase, not 0.0', () => {
    expect(fractionCorrect([])).toBeNull();
  });
  it('is the fraction correct', () => {
    expect(fractionCorrect([{ correct: true }, { correct: false }, { correct: true }, { correct: false }])).toBe(0.5);
    expect(fractionCorrect([{ correct: true }])).toBe(1);
  });
});

describe('buildCsv', () => {
  const row: SubjectCsvRow = {
    subjectId: '11111111-1111-1111-1111-111111111111',
    conditionOrder: 'polymath_first',
    preTestScore: 0.5,
    polymathSessionId: '22222222-2222-2222-2222-222222222222',
    polymathPostScore: 0.75,
    baselineSessionId: '33333333-3333-3333-3333-333333333333',
    baselinePostScore: 0.25,
    followupScore: 1,
    qualitativeNotes: 'liked it',
  };

  it('emits header + a row in column order', () => {
    const csv = buildCsv([row]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toBe(
      '11111111-1111-1111-1111-111111111111,polymath_first,0.5,22222222-2222-2222-2222-222222222222,0.75,33333333-3333-3333-3333-333333333333,0.25,1,liked it',
    );
  });

  it('renders a missing score / null field as empty string (not 0.0)', () => {
    const csv = buildCsv([
      { ...row, preTestScore: null, followupScore: null, qualitativeNotes: null, baselineSessionId: null, baselinePostScore: null },
    ]);
    const cells = csv.trim().split('\n')[1]!.split(',');
    expect(cells[2]).toBe(''); // pre_test_score
    expect(cells[5]).toBe(''); // baseline_session_id
    expect(cells[6]).toBe(''); // baseline_post_score
    expect(cells[7]).toBe(''); // followup_score
    expect(cells[8]).toBe(''); // qualitative_notes
  });

  it('RFC-4180 escapes a notes field with comma/quote/newline', () => {
    const csv = buildCsv([{ ...row, qualitativeNotes: 'a, "b"\nc' }]);
    expect(csv).toContain('"a, ""b""\nc"');
  });
});
