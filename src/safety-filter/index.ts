import { SafetyCheckResult, ClientProfile } from '../types';

// FR-110, FR-504, FR-505, NFR-4
// Blocked topic patterns (pre-check on user input)
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /куда\s+вложить|инвест|акц[ии]|депозит.*доход|облигаци/i, reason: 'financial_advice' },
  { pattern: /личные\s+данные.*другог|паспорт.*чужо/i, reason: 'third_party_pii' },
  { pattern: /взломать|хакнуть|обойти/i, reason: 'security_attack' },
];

const MEDICAL_PATTERNS = /что\s+выпить|что\s+принять|лечение\s+от|симптом|болит|болезнь/i;

const AGE_RESTRICTED_PATTERNS = /алкоголь|пиво|вино|водка|табак|сигарет|казино|ставки/i;

const FINANCIAL_DISCLAIMER =
  'Я не могу давать инвестиционные рекомендации. Для управления финансами перейдите в раздел «Инвестиции» в Halyk Super App.';

const MEDICAL_DISCLAIMER =
  'Я могу помочь найти лекарства в Appteka, но за медицинской консультацией обратитесь к врачу.';

export function preCheck(input: string, client: ClientProfile): SafetyCheckResult {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(input)) {
      return { verdict: 'blocked', reason };
    }
  }

  if (MEDICAL_PATTERNS.test(input)) {
    return { verdict: 'disclaimer_required', disclaimer: MEDICAL_DISCLAIMER };
  }

  if (client.age < 18 && AGE_RESTRICTED_PATTERNS.test(input)) {
    return { verdict: 'blocked', reason: 'age_restriction' };
  }

  return { verdict: 'safe' };
}

// Post-check on LLM output — catches hallucinated sensitive content
export function postCheck(output: string): SafetyCheckResult {
  if (/\b\d{12}\b/.test(output)) {
    // 12-digit IIN leaked
    return { verdict: 'blocked', reason: 'pii_in_output' };
  }

  if (/инвестируйте|покупайте акции|высокая доходность/i.test(output)) {
    return { verdict: 'disclaimer_required', disclaimer: FINANCIAL_DISCLAIMER };
  }

  return { verdict: 'safe' };
}
