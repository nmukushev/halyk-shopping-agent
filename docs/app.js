'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  apiKey: '',
  clientName: 'Нариман',
  clientCity: 'Алматы',
  sessionId: null,
  messages: [],
  cart: [],
};

function saveState() {
  localStorage.setItem('hsa_state', JSON.stringify({
    apiKey: state.apiKey,
    clientName: state.clientName,
    clientCity: state.clientCity,
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem('hsa_state');
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (_) {}
}

// ── Intent Classifier (mirrors src/intent-classifier/index.ts) ─────────────
const RULES = [
  { vertical: 'market',      action: 'add_to_cart', pattern: /купи|добавь в корзину|положи|возьми/i,                           confidence: 0.85 },
  { vertical: 'market',      action: 'subscribe',   pattern: /подпис[иь]|каждую? (неделю|среду|пятницу|месяц)|регулярно/i,     confidence: 0.9  },
  { vertical: 'market',      action: 'track_price', pattern: /когда подешевеет|уведоми.*дешев|отслеживай цену/i,               confidence: 0.9  },
  { vertical: 'market',      action: 'search',      pattern: /найди|поищи|покажи|нужен|нужна|нужно|хочу купить/i,             confidence: 0.7  },
  { vertical: 'appteka',     action: 'search',      pattern: /лекарств|таблетк|аптек|парацетамол|азитромицин|антибиотик|рецепт|препарат/i, confidence: 0.9 },
  { vertical: 'travel',      action: 'search',      pattern: /билет|самолёт|авиа|поезд|тур|отель|лечу/i,                      confidence: 0.9  },
  { vertical: 'kino',        action: 'search',      pattern: /кино|фильм|сеанс|кинотеатр/i,                                   confidence: 0.9  },
  { vertical: 'restaurants', action: 'search',      pattern: /ресторан|кафе|доставка еды|заказать еду/i,                      confidence: 0.9  },
  { vertical: 'general',     action: 'order_status',pattern: /где.*доставка|где.*заказ|когда.*придёт|статус.*заказ/i,         confidence: 0.9  },
];

function classifyIntent(input) {
  let best = { vertical: 'market', action: 'search', confidence: 0.5 };
  for (const rule of RULES) {
    if (rule.pattern.test(input) && rule.confidence > best.confidence) {
      best = { vertical: rule.vertical, action: rule.action, confidence: rule.confidence };
    }
  }
  // Budget extraction
  const budgetMatch = input.match(/до\s+(\d[\d\s]*)(тысяч|тг|тенге)?/i);
  if (budgetMatch) {
    const raw = budgetMatch[1].replace(/\s/g, '');
    best.maxPrice = budgetMatch[2]?.toLowerCase().startsWith('тысяч') ? parseInt(raw) * 1000 : parseInt(raw);
  }
  return best;
}

// ── Safety Filter ──────────────────────────────────────────────────────────
function safetyCheck(input) {
  if (/куда\s+вложить|инвест|акци[ии]|депозит.*доход/i.test(input))
    return { blocked: true, msg: 'Я не даю инвестиционных советов. Перейдите в раздел «Инвестиции» в Halyk App.' };
  if (/личные\s+данные.*другог|паспорт.*чужо/i.test(input))
    return { blocked: true, msg: 'Не могу помочь с персональными данными других людей.' };
  if (/что\s+выпить|что\s+принять|лечение\s+от|симптом|болит/i.test(input))
    return { blocked: false, disclaimer: '⚠️ Обратитесь к врачу. Я могу найти лекарства в Appteka, но не даю медицинских советов.' };
  return { blocked: false };
}

// ── Tool definitions for Claude ────────────────────────────────────────────
const TOOLS = [
  {
    name: 'market_search',
    description: 'Поиск товаров в Halyk Market',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        maxPrice: { type: 'number', description: 'Максимальная цена в тенге' },
        limit: { type: 'number', description: 'Количество результатов' },
      },
      required: ['query'],
    },
  },
  {
    name: 'market_add_to_cart',
    description: 'Добавить товар в корзину Halyk Market по SKU',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        name: { type: 'string' },
        price: { type: 'number' },
        quantity: { type: 'number' },
      },
      required: ['sku', 'name', 'price', 'quantity'],
    },
  },
  {
    name: 'appteka_search',
    description: 'Поиск лекарств в Appteka',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'create_subscription',
    description: 'Создать регулярную подписку на товары',
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'string', description: 'Список товаров' },
        frequency: { type: 'string', description: 'Периодичность (каждую среду, еженедельно и т.д.)' },
      },
      required: ['items', 'frequency'],
    },
  },
  {
    name: 'track_price',
    description: 'Поставить товар на отслеживание цены',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string' },
        targetPrice: { type: 'number' },
      },
      required: ['item', 'targetPrice'],
    },
  },
];

// ── Mock tool executor ─────────────────────────────────────────────────────
const CATALOG = {
  молоко:     [{ sku: 'MK-001', name: 'Молоко Айналайын 2.5%, 1л',         price: 590,   rating: 4.8, reviews: 1240, merchant: 'Halyk Fresh' }],
  хлеб:       [{ sku: 'BR-001', name: 'Хлеб тостовый Аксай, 550г',          price: 380,   rating: 4.5, reviews: 560,  merchant: 'Halyk Fresh' }],
  утюг:       [
    { sku: 'IR-001', name: 'Tefal Pro Express Protect',  price: 49990, rating: 4.7, reviews: 240, merchant: 'Techno Market' },
    { sku: 'IR-002', name: 'Philips Azur DST5030',        price: 39990, rating: 4.5, reviews: 180, merchant: 'Techno Market' },
    { sku: 'IR-003', name: 'Bosch Sensixx DS5 TDA50',     price: 45500, rating: 4.6, reviews: 310, merchant: 'Techno Market' },
  ],
  кроссовки:  [{ sku: 'SN-001', name: 'Nike Air Max 270, р.42',              price: 64990, rating: 4.9, reviews: 88,   merchant: 'Sport KZ' }],
  яйца:       [{ sku: 'EG-001', name: 'Яйца куриные C0, 10шт',               price: 650,   rating: 4.7, reviews: 920,  merchant: 'Halyk Fresh' }],
  фен:        [{ sku: 'HD-001', name: 'Dyson Supersonic HD07',                price: 199900,rating: 4.9, reviews: 142,  merchant: 'Techno Market' }],
};

const DRUGS = [
  { sku: 'AP-001', name: 'Азитромицин капс. 500мг №6', price: 2890, rx: true,  pharmacy: 'Europharma (1.2 км)', pickup: 'сегодня' },
  { sku: 'AP-002', name: 'Парацетамол таб. 500мг №10',  price: 350,  rx: false, pharmacy: 'Europharma (1.2 км)', pickup: 'сегодня' },
  { sku: 'AP-003', name: 'Ибупрофен таб. 400мг №20',    price: 680,  rx: false, pharmacy: 'Maxi Pharm (2.1 км)', pickup: 'сегодня' },
];

function executeTool(name, input) {
  if (name === 'market_search') {
    const q = String(input.query || '').toLowerCase();
    const max = input.maxPrice;
    let results = [];
    for (const [key, items] of Object.entries(CATALOG)) {
      if (q.includes(key) || key.includes(q.split(' ')[0])) {
        results.push(...items);
      }
    }
    if (!results.length) results = Object.values(CATALOG).flat();
    if (max) results = results.filter(i => i.price <= max);
    return { results: results.slice(0, input.limit || 3) };
  }
  if (name === 'market_add_to_cart') {
    state.cart.push({ sku: input.sku, name: input.name, price: input.price, quantity: input.quantity || 1 });
    return { success: true, cartSize: state.cart.length, total: state.cart.reduce((s, i) => s + i.price * i.quantity, 0) };
  }
  if (name === 'appteka_search') {
    const q = String(input.query || '').toLowerCase();
    const results = DRUGS.filter(d => d.name.toLowerCase().includes(q) || q.includes('азитромицин') && d.sku === 'AP-001');
    return { results };
  }
  if (name === 'create_subscription') {
    return { success: true, items: input.items, frequency: input.frequency, nextDelivery: 'ближайшая ' + input.frequency };
  }
  if (name === 'track_price') {
    return { success: true, item: input.item, targetPrice: input.targetPrice, ttlDays: 90 };
  }
  return { error: 'Unknown tool' };
}

// ── Claude API call ────────────────────────────────────────────────────────
async function callClaude(userMessage, intent) {
  const system = `Ты — Halyk Shopping Agent, AI-ассистент для покупок внутри Halyk Super App (Казахстан).
Помогаешь с Market, Appteka, Travel, Kino, Рестораны.
Клиент: ${state.clientName}, ${state.clientCity}.
Отвечай кратко (≤200 символов основной текст), на русском.
Перед добавлением в корзину — показывай детали и проси подтверждение.
Никогда не проводи оплату сам — только подготовь корзину.
Если товара нет по цене — честно скажи, предложи отслеживание цены.`;

  const messages = [
    ...state.messages.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let toolsExecuted = [];
  let currentMessages = [...messages];

  for (let i = 0; i < 5; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        tools: TOOLS,
        messages: currentMessages,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const textBlocks = data.content.filter(b => b.type === 'text');
    const toolBlocks = data.content.filter(b => b.type === 'tool_use');

    if (data.stop_reason === 'end_turn' || !toolBlocks.length) {
      return {
        text: textBlocks.map(b => b.text).join(''),
        toolsExecuted,
        rawContent: data.content,
      };
    }

    // Execute tool calls
    currentMessages.push({ role: 'assistant', content: data.content });
    const toolResults = [];
    for (const block of toolBlocks) {
      const result = executeTool(block.name, block.input);
      toolsExecuted.push({ name: block.name, input: block.input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    currentMessages.push({ role: 'user', content: toolResults });
  }

  return { text: 'Не удалось обработать запрос. Попробуйте ещё раз.', toolsExecuted: [] };
}

// ── UI helpers ─────────────────────────────────────────────────────────────
const messagesArea = document.getElementById('messagesArea');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const headerSubtitle = document.getElementById('headerSubtitle');

function scrollBottom() {
  setTimeout(() => messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' }), 50);
}

function hideWelcome() {
  if (welcomeScreen) welcomeScreen.style.display = 'none';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addUserBubble(text) {
  const ts = Date.now();
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = `
    <div class="bubble-meta">${formatTime(ts)}</div>
    <div class="bubble">${escHtml(text)}</div>
    <div class="bubble-avatar"><i class="ti ti-user"></i></div>
  `;
  messagesArea.appendChild(row);
  scrollBottom();
  return ts;
}

function addTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row agent';
  row.id = 'typing';
  row.innerHTML = `
    <div class="bubble-avatar"><i class="ti ti-robot"></i></div>
    <div class="bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesArea.appendChild(row);
  scrollBottom();
  return row;
}

function removeTyping() {
  const el = document.getElementById('typing');
  if (el) el.remove();
}

function addAgentBubble(text, toolsExecuted, intent) {
  const ts = Date.now();
  const row = document.createElement('div');
  row.className = 'message-row agent';

  // Build bubble content
  let content = '';

  // Intent badge
  const verticalLabels = { market: 'Market', appteka: 'Appteka', travel: 'Travel', kino: 'Kino', restaurants: 'Рестораны', general: 'Общий' };
  if (intent) {
    content += `<div class="intent-badge"><i class="ti ti-cpu"></i> ${verticalLabels[intent.vertical] || intent.vertical}</div>`;
  }

  // Main text
  content += `<div>${escHtml(text).replace(/\n/g, '<br>')}</div>`;

  // Product cards from market_search
  const searchTool = toolsExecuted?.find(t => t.name === 'market_search' && t.result?.results?.length);
  if (searchTool) {
    const cards = searchTool.result.results.map((item, idx) => `
      <div class="product-card" data-sku="${item.sku}" data-name="${escHtml(item.name)}" data-price="${item.price}">
        <div class="product-rank">${idx + 1}</div>
        <div class="product-info">
          <div class="product-name">${escHtml(item.name)}</div>
          <div class="product-meta">⭐ ${item.rating} · ${item.reviews} отзывов · ${item.merchant}</div>
        </div>
        <div class="product-price">${item.price.toLocaleString('ru-RU')} ₸</div>
        <button class="product-add">+ Корзина</button>
      </div>
    `).join('');
    content += `<div class="product-cards">${cards}</div>`;
  }

  // Drug results from appteka_search
  const drugTool = toolsExecuted?.find(t => t.name === 'appteka_search' && t.result?.results?.length);
  if (drugTool) {
    const cards = drugTool.result.results.map((d, idx) => `
      <div class="product-card">
        <div class="product-rank">${idx + 1}</div>
        <div class="product-info">
          <div class="product-name">${escHtml(d.name)} ${d.rx ? '🔴 Рецепт' : '🟢 ОТС'}</div>
          <div class="product-meta">🏪 ${d.pharmacy} · Самовывоз: ${d.pickup}</div>
        </div>
        <div class="product-price">${d.price.toLocaleString('ru-RU')} ₸</div>
      </div>
    `).join('');
    content += `<div class="product-cards">${cards}</div>`;
  }

  // Action chips
  const chips = buildChips(toolsExecuted, text);
  if (chips.length) {
    content += `<div class="action-chips">${chips.map(c => `<button class="action-chip" data-action="${c.action}">${c.label}</button>`).join('')}</div>`;
  }

  row.innerHTML = `
    <div class="bubble-avatar"><i class="ti ti-robot"></i></div>
    <div>
      <div class="bubble">${content}</div>
      <div class="bubble-meta">${formatTime(ts)}</div>
    </div>
  `;

  // Wire up product add buttons
  row.querySelectorAll('.product-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.product-card');
      const sku = card.dataset.sku;
      const name = card.dataset.name;
      const price = parseInt(card.dataset.price);
      executeTool('market_add_to_cart', { sku, name, price, quantity: 1 });
      btn.textContent = '✓ Добавлен';
      btn.disabled = true;
      btn.style.background = '#38a169';
      toast(`${name} добавлен в корзину`);
    });
  });

  // Wire up action chips
  row.querySelectorAll('.action-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value = btn.dataset.action;
      sendMessage();
    });
  });

  messagesArea.appendChild(row);
  scrollBottom();
}

function buildChips(toolsExecuted, text) {
  const chips = [];
  if (text.includes('Подтвердить') || text.includes('подтвердить?')) {
    chips.push({ label: '✅ Да, подтвердить', action: 'Да, подтверждаю' });
    chips.push({ label: '❌ Отмена', action: 'Отмена' });
  }
  if (toolsExecuted?.some(t => t.name === 'market_search')) {
    chips.push({ label: '🛒 Добавить первый', action: 'Добавь первый вариант в корзину' });
  }
  if (text.includes('отслеживани') || text.includes('отследить')) {
    chips.push({ label: '📌 Да, отслеживать', action: 'Да, поставь на отслеживание' });
  }
  return chips;
}

// ── Send message ────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  if (!state.apiKey) {
    openSettings();
    toast('Введите API ключ Anthropic', true);
    return;
  }

  // Safety check
  const safety = safetyCheck(text);
  if (safety.blocked) {
    hideWelcome();
    addUserBubble(text);
    state.messages.push({ role: 'user', content: text, ts: Date.now() });
    const ts = Date.now();
    const row = document.createElement('div');
    row.className = 'message-row agent';
    row.innerHTML = `
      <div class="bubble-avatar"><i class="ti ti-robot"></i></div>
      <div>
        <div class="bubble"><div class="disclaimer"><i class="ti ti-alert-triangle"></i>${escHtml(safety.msg)}</div></div>
        <div class="bubble-meta">${formatTime(ts)}</div>
      </div>
    `;
    messagesArea.appendChild(row);
    state.messages.push({ role: 'assistant', content: safety.msg, ts });
    messageInput.value = '';
    updateInputUI();
    scrollBottom();
    return;
  }

  hideWelcome();
  messageInput.value = '';
  updateInputUI();
  sendBtn.disabled = true;

  addUserBubble(text);
  state.messages.push({ role: 'user', content: text, ts: Date.now() });

  const intent = classifyIntent(text);
  const verticalNames = { market: 'Market', appteka: 'Appteka', travel: 'Travel', kino: 'Kino', restaurants: 'Рестораны', general: 'Общий' };
  headerSubtitle.textContent = `Вертикаль: ${verticalNames[intent.vertical]} · уверенность ${Math.round(intent.confidence * 100)}%`;

  const typing = addTypingIndicator();

  try {
    const { text: reply, toolsExecuted } = await callClaude(text, intent);
    removeTyping();

    let finalReply = reply;
    if (safety.disclaimer) {
      finalReply = `${reply}\n\n${safety.disclaimer}`;
    }

    addAgentBubble(finalReply, toolsExecuted, intent);
    state.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
  } catch (e) {
    removeTyping();
    const errMsg = e.message || 'Ошибка';
    addAgentBubble(`Ошибка: ${errMsg}`, [], null);
    toast(errMsg, true);
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// ── Input UI ────────────────────────────────────────────────────────────────
function updateInputUI() {
  const len = messageInput.value.length;
  charCount.textContent = `${len} / 1000`;
  sendBtn.disabled = len === 0;
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

messageInput.addEventListener('input', updateInputUI);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(); }
});
sendBtn.addEventListener('click', sendMessage);

// ── Example buttons ──────────────────────────────────────────────────────────
document.querySelectorAll('.example-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    messageInput.value = btn.dataset.msg;
    updateInputUI();
    messageInput.focus();
  });
});

// ── Clear chat ───────────────────────────────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!state.messages.length) return;
  if (!confirm('Очистить историю чата?')) return;
  state.messages = [];
  state.cart = [];
  messagesArea.innerHTML = '';
  messagesArea.appendChild(welcomeScreen);
  welcomeScreen.style.display = '';
  headerSubtitle.textContent = 'Чем могу помочь сегодня?';
});

// ── Vertical sidebar ─────────────────────────────────────────────────────────
document.querySelectorAll('.vertical-item:not(.coming)').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.vertical-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});

// ── Settings modal ────────────────────────────────────────────────────────────
const settingsModal = document.getElementById('settingsModal');

function openSettings() {
  document.getElementById('apiKeyField').value = state.apiKey;
  document.getElementById('clientName').value = state.clientName;
  document.getElementById('clientCity').value = state.clientCity;
  settingsModal.style.display = 'flex';
}

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('apiKeyHeaderBtn').addEventListener('click', openSettings);
document.getElementById('settingsClose').addEventListener('click', () => settingsModal.style.display = 'none');
document.getElementById('settingsCancel').addEventListener('click', () => settingsModal.style.display = 'none');
document.getElementById('settingsSave').addEventListener('click', () => {
  state.apiKey = document.getElementById('apiKeyField').value.trim();
  state.clientName = document.getElementById('clientName').value.trim() || 'Клиент';
  state.clientCity = document.getElementById('clientCity').value.trim() || 'Алматы';
  saveState();
  settingsModal.style.display = 'none';
  toast('Настройки сохранены');
});

document.getElementById('toggleVis').addEventListener('click', () => {
  const field = document.getElementById('apiKeyField');
  const icon = document.querySelector('#toggleVis i');
  if (field.type === 'password') { field.type = 'text'; icon.className = 'ti ti-eye-off'; }
  else { field.type = 'password'; icon.className = 'ti ti-eye'; }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = error ? '#e53e3e' : '#1a202c';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadState();
if (!state.apiKey) setTimeout(openSettings, 500);
messageInput.focus();
