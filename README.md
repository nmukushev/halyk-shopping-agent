# Halyk Shopping Agent — Phase 0 Foundation

Скелет репозитория + working PoC разговорного AI-агента для Halyk Super App.

## Архитектура

```
src/
├── types.ts               # Общие типы (FR-302 unified purchase schema)
├── safety-filter/         # Pre/post фильтрация (FR-110, FR-504, FR-505)
├── intent-classifier/     # Классификация вертикали + action (section 12.2)
├── memory-store/          # Сессионная и долговременная память (FR-105, FR-106)
├── tool-router/           # Маршрутизация вызовов API вертикалей (section 12.2)
│   └── tools/
│       ├── market.ts      # Halyk Market (mock)
│       ├── appteka.ts     # Appteka (mock)
│       └── travel.ts      # Halyk Travel (mock)
├── llm-service/           # Claude claude-sonnet-4-6 с function calling (OPEN: OQ-2)
├── orchestrator/          # Главный координатор (section 12.3)
└── index.ts               # CLI demo / PoC entry point
tests/
└── poc.test.ts            # Тест-харнесс: classifier, safety, tools, edge cases
```

## Запуск PoC

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run poc
```

Примеры запросов:
- `Купи молоко и хлеб` → UJ-1
- `Нужен утюг до 50 тысяч` → UJ-2
- `Есть рецепт на азитромицин, нужно сегодня` → UJ-3
- `Подпиши меня на молоко каждую среду` → UJ-4

## Тесты

```bash
npm test
```

Покрывают: intent classifier, safety filter (FR-504, FR-505), tool router, edge cases EC-2, EC-7, EC-10, EC-11, EC-12.

## Open Questions (блокируют Phase 1)

| ID | Вопрос | Дедлайн |
|----|--------|---------|
| OQ-1 | Скоуп MVP | 10.06.2026 |
| OQ-2 | LLM-вендор (сейчас Anthropic Claude) | 13.06.2026 |
| OQ-3 | QazTech-мораторий | 13.06.2026 |
| OQ-5 | ASR/TTS поставщик | 17.06.2026 |

## Roadmap (section 15.2)

- **Phase 0** ✅ Foundation skeleton + PoC (этот репо)
- **Phase 1** First vertical (Halyk Fresh) — +2 мес
- **Phase 2** Voice (ASR/TTS) — +1.5 мес
- **Phase 3** Appteka — +1.5 мес
- **Phase 4** Memory & personalization — +2 мес
- **Phase 5** Travel, Kino, Restaurants — +3 мес

## Что НЕ делаем сейчас (section 17)

- Frontend в HSA — ждём UI-флоу от продакт-лида и дизайн-команды
- Реальные API вертикалей — ждём решения OQ-2 и OQ-3
- Полную автономную оплату — никогда
