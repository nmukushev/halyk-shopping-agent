import Anthropic from '@anthropic-ai/sdk';
import { SessionContext, ClientMemory } from '../types';
import { getToolsForVertical } from '../tool-router';
import { executeToolCall } from '../tool-router';
import type { Vertical } from '../types';

// OPEN (OQ-2, OQ-3): vendor selection — Anthropic Claude / on-prem.
// This module abstracts the LLM behind a stable interface so swapping is a
// one-file change.

const MAX_TOOL_ITERATIONS = 5; // section 12.3, step 8

const SYSTEM_PROMPT = `Ты — Halyk Shopping Agent, умный покупательский ассистент внутри Halyk Super App.

Правила:
- Помогаешь только с покупками внутри экосистемы Halyk (Market, Appteka, Travel, Kino, Рестораны).
- Отвечаешь кратко (≤200 символов в основном тексте), по делу.
- Финансовые советы, медицинские диагнозы — отказывай и направляй к специалисту.
- Алкоголь и рецептурные лекарства несовершеннолетним — отказывай.
- Никогда не проводи оплату сам. Всегда передавай на подтверждение клиенту.
- Говоришь на языке клиента (ru/kk).
- Перед любым действием с деньгами — запрашивай подтверждение.`;

export interface LLMResponse {
  text: string;
  toolsExecuted: Array<{ tool: string; result: unknown }>;
}

export async function chat(
  userMessage: string,
  session: SessionContext,
  memory: ClientMemory,
  vertical: Vertical,
  apiKey: string,
): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey });
  const tools = getToolsForVertical(vertical);

  // Build context from session + memory
  const systemWithContext = buildSystemContext(SYSTEM_PROMPT, memory, session);

  // Convert session messages to Anthropic format
  const messages: Anthropic.MessageParam[] = [
    ...session.messages.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const toolsExecuted: Array<{ tool: string; result: unknown }> = [];
  let iterCount = 0;
  let lastText = '';

  // Agentic loop (section 12.3, steps 6-8)
  while (iterCount < MAX_TOOL_ITERATIONS) {
    iterCount++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemWithContext,
      tools: tools as Anthropic.Tool[],
      messages,
    });

    // Collect any text blocks
    const textBlocks = response.content.filter(b => b.type === 'text');
    if (textBlocks.length) {
      lastText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('');
    }

    if (response.stop_reason === 'end_turn') break;

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

      // Add assistant message with tool calls
      messages.push({ role: 'assistant', content: response.content });

      // Execute all tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const result = await executeToolCall(
          { name: block.name, input: block.input as Record<string, unknown> },
          session.clientId,
        );
        toolsExecuted.push({ tool: block.name, result: result.data });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result.data),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  return { text: lastText, toolsExecuted };
}

function buildSystemContext(base: string, memory: ClientMemory, session: SessionContext): string {
  const parts = [base];

  if (memory.preferences.length) {
    const prefs = memory.preferences.map(p => `${p.key}: ${p.value}${p.isStrict ? ' (СТРОГО)' : ''}`).join('; ');
    parts.push(`\nПредпочтения клиента: ${prefs}`);
  }

  if (memory.frequentSkus.length) {
    parts.push(`\nЧасто покупает SKU: ${memory.frequentSkus.slice(0, 5).join(', ')}`);
  }

  if (session.currentCart.length) {
    const cartSummary = session.currentCart.map(i => `${i.name} x${i.quantity}`).join(', ');
    parts.push(`\nТекущая корзина: ${cartSummary}`);
  }

  if (memory.budgetLimit) {
    parts.push(`\nБюджетный лимит: ${memory.budgetLimit.toLocaleString('ru-RU')} тг/мес`);
  }

  return parts.join('');
}
