// PoC entry point: runs the demo scenarios from section 3.2 (UJ-1, UJ-2, UJ-3)
// Usage: ANTHROPIC_API_KEY=sk-ant-... npx ts-node src/index.ts

import * as readline from 'readline';
import { handleMessage } from './orchestrator';
import { ClientProfile } from './types';

const DEMO_CLIENT: ClientProfile = {
  clientId: 'demo-001',
  name: 'Нариман',
  language: 'ru',
  kycStatus: 'verified',
  age: 35,
  city: 'Алматы',
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Укажите ANTHROPIC_API_KEY в переменных окружения');
  process.exit(1);
}

const config = { apiKey };
let sessionId: string | null = null;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('═══════════════════════════════════════════════════');
console.log('  Halyk Shopping Agent — PoC (Phase 0)');
console.log('  Клиент: Нариман, Алматы | Введите "выход" для выхода');
console.log('═══════════════════════════════════════════════════\n');
console.log('Примеры запросов:');
console.log('  → Купи молоко и хлеб');
console.log('  → Нужен утюг до 50 тысяч');
console.log('  → Есть рецепт на азитромицин, нужно сегодня');
console.log('  → Подпиши меня на молоко каждую среду\n');

function ask(): void {
  rl.question('Вы: ', async (input) => {
    input = input.trim();
    if (!input || input.toLowerCase() === 'выход') {
      console.log('До свидания!');
      rl.close();
      return;
    }

    try {
      const response = await handleMessage(input, DEMO_CLIENT, sessionId, config);
      sessionId = response.sessionContext.sessionId;

      console.log(`\nАгент: ${response.text}`);
      if (response.suggestedActions?.length) {
        console.log(`       [${response.suggestedActions.join(' | ')}]`);
      }
      console.log();
    } catch (err) {
      console.error('Ошибка:', err);
    }

    ask();
  });
}

ask();
