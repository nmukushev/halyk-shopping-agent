// Mock Travel API tools

export const travelTools = [
  {
    name: 'travel_search_flights',
    description: 'Поиск авиабилетов',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'Город отправления' },
        destination: { type: 'string', description: 'Город назначения' },
        date: { type: 'string', description: 'Дата вылета ISO8601' },
        passengers: { type: 'number' },
      },
      required: ['origin', 'destination', 'date'],
    },
  },
] as const;

export function executeTool(name: string, input: Record<string, unknown>): unknown {
  if (name === 'travel_search_flights') {
    return {
      flights: [
        { flightNo: 'KC812', departure: '08:00', arrival: '11:30', price: 45000, airline: 'Air Astana', seatsLeft: 12 },
        { flightNo: 'HY201', departure: '14:15', arrival: '17:45', price: 38500, airline: 'Uzbekistan Airways', seatsLeft: 5 },
      ],
      currency: 'KZT',
      origin: input.origin,
      destination: input.destination,
      date: input.date,
    };
  }
  return { error: `Unknown travel tool: ${name}` };
}
