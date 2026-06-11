import { Intent, Vertical, IntentAction } from '../types';

// Lightweight rule-based classifier (Phase 0).
// OPEN: replace with fine-tuned small model for ≤50ms inference (section 12.2).
// Falls back to LLM when confidence < THRESHOLD.
export const CONFIDENCE_THRESHOLD = 0.8;

interface Rule {
  vertical: Vertical;
  action: IntentAction;
  patterns: RegExp[];
  weight: number;
}

const RULES: Rule[] = [
  // Market
  { vertical: 'market', action: 'search',
    patterns: [/найди|поищи|покажи|есть ли|хочу купить|нужен|нужна|нужно/i], weight: 0.7 },
  { vertical: 'market', action: 'add_to_cart',
    patterns: [/купи|добавь в корзину|положи в корзину|возьми/i], weight: 0.85 },
  { vertical: 'market', action: 'subscribe',
    patterns: [/подпис[иь]|каждую? (неделю|среду|пятницу|месяц)|регулярно|каждый/i], weight: 0.9 },
  { vertical: 'market', action: 'track_price',
    patterns: [/когда подешевеет|уведоми.*дешев|отслеживай цену/i], weight: 0.9 },

  // Appteka
  { vertical: 'appteka', action: 'search',
    patterns: [/лекарств|таблетк|аптек|парацетамол|ибупрофен|антибиотик|рецепт|препарат/i], weight: 0.9 },

  // Travel
  { vertical: 'travel', action: 'search',
    patterns: [/билет|самолёт|авиа|поезд|тур|отель|лечу|полёт/i], weight: 0.9 },

  // Kino
  { vertical: 'kino', action: 'search',
    patterns: [/кино|фильм|сеанс|кинотеатр|билет в кино/i], weight: 0.9 },

  // Restaurants
  { vertical: 'restaurants', action: 'search',
    patterns: [/ресторан|кафе|доставка еды|заказать еду|столик/i], weight: 0.9 },

  // Order status (cross-vertical)
  { vertical: 'general', action: 'order_status',
    patterns: [/где.*доставка|где.*заказ|когда.*придёт|статус.*заказ/i], weight: 0.9 },

  // Return
  { vertical: 'general', action: 'return',
    patterns: [/верн[уи]|возврат|отмен[иь] заказ/i], weight: 0.85 },
];

export function classify(input: string): Intent {
  let best: Intent = {
    vertical: 'general',
    action: 'general_query',
    confidence: 0.4,
    params: {},
  };

  for (const rule of RULES) {
    const matched = rule.patterns.some(p => p.test(input));
    if (matched && rule.weight > best.confidence) {
      best = {
        vertical: rule.vertical,
        action: rule.action,
        confidence: rule.weight,
        params: extractParams(input, rule.vertical),
      };
    }
  }

  return best;
}

function extractParams(input: string, vertical: Vertical): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Extract budget hint (e.g. "до 50 тысяч", "до 50000")
  const budgetMatch = input.match(/до\s+(\d[\d\s]*)(тысяч|тг|тенге)?/i);
  if (budgetMatch) {
    const raw = budgetMatch[1].replace(/\s/g, '');
    params.maxPrice = budgetMatch[2]?.toLowerCase().startsWith('тысяч')
      ? parseInt(raw) * 1000
      : parseInt(raw);
  }

  if (vertical === 'market' || vertical === 'appteka') {
    // Extract quantity hint
    const qtyMatch = input.match(/(\d+)\s*(шт|штук|пачк|литр|л\b|кг|упаков)/i);
    if (qtyMatch) params.quantity = parseInt(qtyMatch[1]);
  }

  return params;
}
