// Test harness for Phase 0 (section 17, step 6)
// Tests cover: intent classifier, safety filter, tool router, edge cases from section 3.3

import { classify } from '../src/intent-classifier';
import { preCheck } from '../src/safety-filter';
import { executeToolCall } from '../src/tool-router';
import type { ClientProfile } from '../src/types';

const ADULT_CLIENT: ClientProfile = {
  clientId: 'test-adult', name: 'Test', language: 'ru',
  kycStatus: 'verified', age: 30, city: 'Алматы',
};
const MINOR_CLIENT: ClientProfile = {
  clientId: 'test-minor', name: 'Minor', language: 'ru',
  kycStatus: 'verified', age: 16, city: 'Алматы',
};

// ── Intent Classifier ─────────────────────────────────────────────────────

describe('IntentClassifier', () => {
  test('market add_to_cart', () => {
    const intent = classify('Купи молоко и хлеб');
    expect(intent.vertical).toBe('market');
    expect(intent.action).toBe('add_to_cart');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('market search with budget (UJ-2)', () => {
    const intent = classify('Нужен утюг до 50 тысяч, чтобы хороший');
    expect(intent.vertical).toBe('market');
    expect(intent.params.maxPrice).toBe(50000);
  });

  test('appteka search (UJ-3)', () => {
    const intent = classify('Есть рецепт на азитромицин, нужно сегодня');
    expect(intent.vertical).toBe('appteka');
  });

  test('market subscribe (UJ-4)', () => {
    const intent = classify('Подпиши меня на молоко каждую среду');
    expect(intent.vertical).toBe('market');
    expect(intent.action).toBe('subscribe');
  });

  test('travel search', () => {
    const intent = classify('Билеты на самолёт в Алматы');
    expect(intent.vertical).toBe('travel');
  });

  test('order status (cross-vertical)', () => {
    const intent = classify('Где моя доставка, когда придёт?');
    expect(intent.action).toBe('order_status');
  });
});

// ── Safety Filter ─────────────────────────────────────────────────────────

describe('SafetyFilter', () => {
  test('blocks financial advice (FR-504, EC-10)', () => {
    const result = preCheck('Куда вложить деньги?', ADULT_CLIENT);
    expect(result.verdict).toBe('blocked');
    expect(result.reason).toBe('financial_advice');
  });

  test('requires disclaimer for medical query (EC-11)', () => {
    const result = preCheck('Что выпить от боли в горле?', ADULT_CLIENT);
    expect(result.verdict).toBe('disclaimer_required');
  });

  test('blocks alcohol for minor (FR-505, EC-12)', () => {
    const result = preCheck('Купи вино', MINOR_CLIENT);
    expect(result.verdict).toBe('blocked');
    expect(result.reason).toBe('age_restriction');
  });

  test('allows alcohol for adult', () => {
    const result = preCheck('Купи вино', ADULT_CLIENT);
    expect(result.verdict).toBe('safe');
  });

  test('passes normal shopping query', () => {
    const result = preCheck('Купи молоко и хлеб', ADULT_CLIENT);
    expect(result.verdict).toBe('safe');
  });

  test('blocks third-party PII request (EC-7)', () => {
    const result = preCheck('Покажи личные данные другого человека', ADULT_CLIENT);
    expect(result.verdict).toBe('blocked');
  });
});

// ── Tool Router / Mock tools ───────────────────────────────────────────────

describe('ToolRouter - Market', () => {
  test('market_search finds milk', async () => {
    const result = await executeToolCall(
      { name: 'market_search', input: { query: 'молоко' } },
      'test-001',
    );
    expect(result.success).toBe(true);
    const data = result.data as { results: unknown[] };
    expect(data.results.length).toBeGreaterThan(0);
  });

  test('market_search applies maxPrice filter', async () => {
    const result = await executeToolCall(
      { name: 'market_search', input: { query: 'утюг', maxPrice: 40000 } },
      'test-001',
    );
    expect(result.success).toBe(true);
    const data = result.data as { results: Array<{ price: number }> };
    data.results.forEach(r => expect(r.price).toBeLessThanOrEqual(40000));
  });

  test('market_add_to_cart adds item', async () => {
    const result = await executeToolCall(
      { name: 'market_add_to_cart', input: { sku: 'MK-001', quantity: 2 } },
      'test-001',
    );
    expect(result.success).toBe(true);
    const data = result.data as { success: boolean };
    expect(data.success).toBe(true);
  });

  test('market_get_cart reflects added items', async () => {
    // Add items first
    await executeToolCall({ name: 'market_add_to_cart', input: { sku: 'BR-001', quantity: 1 } }, 'test-cart');
    const result = await executeToolCall({ name: 'market_get_cart', input: {} }, 'test-cart');
    expect(result.success).toBe(true);
    const data = result.data as { items: unknown[]; total: number };
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
  });
});

describe('ToolRouter - Appteka', () => {
  test('appteka_search finds azithromycin (UJ-3)', async () => {
    const result = await executeToolCall(
      { name: 'appteka_search', input: { query: 'азитромицин' } },
      'test-001',
    );
    expect(result.success).toBe(true);
    const data = result.data as { results: Array<{ name: string }> };
    expect(data.results.length).toBeGreaterThan(0);
  });
});

// ── Edge cases from PRD section 3.3 ─────────────────────────────────────

describe('EdgeCases', () => {
  test('EC-2: impossible request returns no results (nike under 50k)', async () => {
    const result = await executeToolCall(
      { name: 'market_search', input: { query: 'кроссовки', maxPrice: 50000 } },
      'test-001',
    );
    // Nike Air Max is 64990 — should not appear in results
    const data = result.data as { results: Array<{ price: number }> };
    data.results.forEach(r => expect(r.price).toBeLessThanOrEqual(50000));
  });
});
