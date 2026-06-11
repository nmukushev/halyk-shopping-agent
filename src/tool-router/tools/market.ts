// Mock Market API tools (FR-201, FR-202)
// OPEN: replace mock data with real Market API adapter

export const marketTools = [
  {
    name: 'market_search',
    description: 'Поиск товаров в Halyk Market по запросу и фильтрам',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        maxPrice: { type: 'number', description: 'Максимальная цена в тенге' },
        category: { type: 'string', description: 'Категория товара' },
        limit: { type: 'number', description: 'Количество результатов (default 3)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'market_add_to_cart',
    description: 'Добавить товар в корзину Halyk Market',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string', description: 'SKU товара' },
        quantity: { type: 'number', description: 'Количество' },
      },
      required: ['sku', 'quantity'],
    },
  },
  {
    name: 'market_get_cart',
    description: 'Получить текущую корзину клиента',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;

const MOCK_CATALOG: Record<string, { sku: string; name: string; price: number; rating: number; reviews: number; category: string; merchantId: string }[]> = {
  молоко: [
    { sku: 'MK-001', name: 'Молоко Айналайын 2.5%, 1л', price: 590, rating: 4.8, reviews: 1240, category: 'dairy', merchantId: 'halyk-fresh' },
    { sku: 'MK-002', name: 'Молоко Простоквашино 3.2%, 900мл', price: 650, rating: 4.6, reviews: 890, category: 'dairy', merchantId: 'halyk-fresh' },
  ],
  хлеб: [
    { sku: 'BR-001', name: 'Хлеб тостовый Аксай, 550г', price: 380, rating: 4.5, reviews: 560, category: 'bakery', merchantId: 'halyk-fresh' },
    { sku: 'BR-002', name: 'Батон нарезной Аул, 400г', price: 290, rating: 4.3, reviews: 340, category: 'bakery', merchantId: 'halyk-fresh' },
  ],
  утюг: [
    { sku: 'IR-001', name: 'Tefal Pro Express Protect GV9220', price: 49990, rating: 4.7, reviews: 240, category: 'appliances', merchantId: 'techno-market' },
    { sku: 'IR-002', name: 'Philips Azur DST5030', price: 39990, rating: 4.5, reviews: 180, category: 'appliances', merchantId: 'techno-market' },
    { sku: 'IR-003', name: 'Bosch Sensixx DS5 TDA50', price: 45500, rating: 4.6, reviews: 310, category: 'appliances', merchantId: 'techno-market' },
  ],
  кроссовки: [
    { sku: 'SN-001', name: 'Nike Air Max 270, р.42', price: 64990, rating: 4.9, reviews: 88, category: 'footwear', merchantId: 'sport-kz' },
  ],
  яйца: [
    { sku: 'EG-001', name: 'Яйца куриные C0, 10шт', price: 650, rating: 4.7, reviews: 920, category: 'dairy', merchantId: 'halyk-fresh' },
  ],
};

interface CartEntry { sku: string; quantity: number }
const mockCarts: Record<string, CartEntry[]> = {};

export function executeTool(name: string, input: Record<string, unknown>, clientId: string): unknown {
  if (name === 'market_search') {
    const query = String(input.query || '').toLowerCase();
    const maxPrice = input.maxPrice as number | undefined;
    const limit = (input.limit as number) || 3;

    const results = Object.entries(MOCK_CATALOG)
      .filter(([key]) => query.includes(key) || key.includes(query))
      .flatMap(([, items]) => items)
      .filter(item => !maxPrice || item.price <= maxPrice)
      .slice(0, limit);

    if (!results.length) {
      // fuzzy fallback
      const all = Object.values(MOCK_CATALOG).flat();
      return { results: all.filter(i => !maxPrice || i.price <= maxPrice).slice(0, limit), found: false };
    }

    return { results, found: true };
  }

  if (name === 'market_add_to_cart') {
    const sku = String(input.sku);
    const quantity = (input.quantity as number) || 1;
    const allItems = Object.values(MOCK_CATALOG).flat();
    const item = allItems.find(i => i.sku === sku);
    if (!item) return { success: false, error: 'SKU not found' };

    if (!mockCarts[clientId]) mockCarts[clientId] = [];
    const existing = mockCarts[clientId].find(e => e.sku === sku);
    if (existing) {
      existing.quantity += quantity;
    } else {
      mockCarts[clientId].push({ sku, quantity });
    }

    return { success: true, item: { ...item, quantity }, cartSize: mockCarts[clientId].length };
  }

  if (name === 'market_get_cart') {
    const cart = mockCarts[clientId] || [];
    const allItems = Object.values(MOCK_CATALOG).flat();
    const enriched = cart.map(e => {
      const item = allItems.find(i => i.sku === e.sku);
      return item ? { ...item, quantity: e.quantity, subtotal: item.price * e.quantity } : e;
    });
    const total = enriched.reduce((sum, i) => sum + ('subtotal' in i ? i.subtotal : 0), 0);
    return { items: enriched, total, deliveryFee: total > 0 ? 500 : 0 };
  }

  return { error: `Unknown market tool: ${name}` };
}
