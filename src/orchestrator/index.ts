import { v4 as uuidv4 } from 'uuid';
import { AgentResponse, SessionContext, ClientProfile, Message } from '../types';
import { classify, CONFIDENCE_THRESHOLD } from '../intent-classifier';
import { preCheck, postCheck } from '../safety-filter';
import { memoryStore } from '../memory-store';
import { chat } from '../llm-service';

// Section 12.2 — Shopping Agent Orchestrator
// Stateless; state lives in memoryStore (Redis replacement in prod).

export interface OrchestratorConfig {
  apiKey: string;
}

export async function handleMessage(
  userInput: string,
  clientProfile: ClientProfile,
  sessionId: string | null,
  config: OrchestratorConfig,
): Promise<AgentResponse> {
  // 1. Load or create session
  const sid = sessionId || uuidv4();
  let session: SessionContext = memoryStore.getSession(sid) || {
    sessionId: sid,
    clientId: clientProfile.clientId,
    messages: [],
    currentCart: [],
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
  session.lastActivityAt = new Date().toISOString();

  // 2. Safety pre-check (section 12.3, step 3)
  const safetyPre = preCheck(userInput, clientProfile);
  if (safetyPre.verdict === 'blocked') {
    return buildResponse(session, blockedMessage(safetyPre.reason), false);
  }

  // 3. Intent classification (section 12.3, step 4)
  const intent = classify(userInput);
  session.activeVertical = intent.vertical;
  session.lastIntent = intent;

  // FR-108: low confidence → disambiguation
  if (intent.confidence < CONFIDENCE_THRESHOLD) {
    const disambig = `Уточните, пожалуйста: вы ищете товар или что-то другое?`;
    return buildResponse(session, disambig, false);
  }

  // 4. Load long-term memory (section 12.3, step 5)
  const memory = memoryStore.getMemory(clientProfile.clientId);

  // 5. LLM call with tool use (section 12.3, steps 6-8)
  const llmResponse = await chat(
    userInput,
    session,
    memory,
    intent.vertical,
    config.apiKey,
  );

  // 6. Safety post-check (section 12.3, step 9)
  const safetyPost = postCheck(llmResponse.text);
  let finalText = llmResponse.text;
  if (safetyPost.verdict === 'blocked') {
    finalText = 'Извините, не могу ответить на этот вопрос.';
  } else if (safetyPost.verdict === 'disclaimer_required' && safetyPost.disclaimer) {
    finalText = `${finalText}\n\n⚠️ ${safetyPost.disclaimer}`;
  }
  if (safetyPre.verdict === 'disclaimer_required' && safetyPre.disclaimer) {
    finalText = `⚠️ ${safetyPre.disclaimer}\n\n${finalText}`;
  }

  // 7. Update session messages
  const now = new Date().toISOString();
  const userMsg: Message = { role: 'user', content: userInput, timestamp: now };
  const assistantMsg: Message = { role: 'assistant', content: finalText, timestamp: now };
  session.messages.push(userMsg, assistantMsg);

  // 8. Persist session (section 12.3, step 11)
  memoryStore.saveSession(session);

  // 9. Determine if handoff to checkout is needed
  const handoffToCheckout = /подтвердить|оформить заказ|перейти к оплате/i.test(finalText)
    || /checkout/i.test(finalText);

  return buildResponse(session, finalText, handoffToCheckout, llmResponse.toolsExecuted);
}

function buildResponse(
  session: SessionContext,
  text: string,
  handoffToCheckout: boolean,
  toolsExecuted?: Array<{ tool: string; result: unknown }>,
): AgentResponse {
  const requiresConfirmation = /подтвердить\?|оформить\?|да\/нет/i.test(text);

  const suggested: string[] = [];
  if (requiresConfirmation) {
    suggested.push('✅ Да, подтвердить', '❌ Отмена');
  } else if (session.currentCart.length > 0) {
    suggested.push('🛒 Перейти к оплате', '➕ Продолжить покупки');
  }

  console.log(`[Orchestrator] session=${session.sessionId} vertical=${session.activeVertical} tools=${toolsExecuted?.map(t => t.tool).join(',') || 'none'}`);

  return {
    text,
    requiresConfirmation,
    handoffToCheckout,
    suggestedActions: suggested,
    sessionContext: session,
  };
}

function blockedMessage(reason?: string): string {
  const messages: Record<string, string> = {
    financial_advice: 'Я не даю инвестиционных советов. Перейдите в раздел «Инвестиции» в Halyk App.',
    age_restriction: 'Этот товар недоступен для вашей возрастной группы.',
    third_party_pii: 'Не могу помочь с данными других людей.',
    security_attack: 'Этот запрос не поддерживается.',
  };
  return messages[reason || ''] || 'Извините, не могу выполнить этот запрос.';
}
