// Mock Appteka API tools (FR-201 for pharma vertical)

export const apptekaTools = [
  {
    name: 'appteka_search',
    description: 'Поиск лекарств в Appteka с проверкой наличия в аптеках',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Название препарата или активного вещества' },
        city: { type: 'string', description: 'Город клиента' },
        requiresRx: { type: 'boolean', description: 'Рецептурный препарат' },
      },
      required: ['query'],
    },
  },
  {
    name: 'appteka_check_pharmacy',
    description: 'Проверить ближайшую аптеку с наличием препарата',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['sku'],
    },
  },
] as const;

const MOCK_DRUGS = [
  { sku: 'AP-001', name: 'Азитромицин капс. 500мг №6', price: 2890, requiresRx: true, inStock: true },
  { sku: 'AP-002', name: 'Парацетамол таб. 500мг №10', price: 350, requiresRx: false, inStock: true },
  { sku: 'AP-003', name: 'Ибупрофен таб. 400мг №20', price: 680, requiresRx: false, inStock: true },
  { sku: 'AP-004', name: 'Амоксициллин капс. 500мг №16', price: 1450, requiresRx: true, inStock: false },
];

const MOCK_PHARMACIES = [
  { name: 'Europharma', address: 'ул. Абая 12', distanceKm: 1.2, hasDelivery: true, pickupToday: true },
  { name: 'Аптека 36.6', address: 'пр. Достык 8', distanceKm: 2.4, hasDelivery: true, pickupToday: true },
  { name: 'Maxi Pharm', address: 'ул. Толе би 44', distanceKm: 3.8, hasDelivery: false, pickupToday: true },
];

export function executeTool(name: string, input: Record<string, unknown>): unknown {
  if (name === 'appteka_search') {
    const query = String(input.query || '').toLowerCase();
    const results = MOCK_DRUGS.filter(d => d.name.toLowerCase().includes(query) || query.includes('азитромицин') && d.sku === 'AP-001');
    return { results, count: results.length };
  }

  if (name === 'appteka_check_pharmacy') {
    const sku = String(input.sku);
    const drug = MOCK_DRUGS.find(d => d.sku === sku);
    if (!drug) return { found: false };
    return {
      drug,
      pharmacies: drug.inStock ? MOCK_PHARMACIES : [],
      nearestPickupToday: MOCK_PHARMACIES[0],
    };
  }

  return { error: `Unknown appteka tool: ${name}` };
}
