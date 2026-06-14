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

// ── Real catalog from halykmarket.kz ──────────────────────────────────────
// Prices fetched June 2026. url — прямая ссылка на товар.
const CATALOG = [
  // ── Смартфоны ────────────────────────────────────────────────────────────
  { sku: 'SM-001', name: 'Samsung Galaxy S24 Ultra 5G 12/256Gb Titanium Gray', price: 388489, oldPrice: 450000, rating: 4.9, reviews: 312, merchant: 'Samsung KZ', category: 'смартфоны', tags: ['смартфон','samsung','s24','телефон','galaxy'], url: 'https://halykmarket.kz/category/smartfony/smartfon-samsung-galaxy-s24-ultra-5g?sku=12256gb_titanium-gray' },
  { sku: 'SM-002', name: 'Samsung Galaxy S24 Plus 5G 12/256Gb Onyx Black',    price: 358612, oldPrice: 420000, rating: 4.8, reviews: 198, merchant: 'Samsung KZ', category: 'смартфоны', tags: ['смартфон','samsung','s24','телефон','galaxy'], url: 'https://halykmarket.kz/category/smartfony/smartfon-samsung-galaxy-s24-5g?sku=12256gb_onyx-black' },
  { sku: 'SM-003', name: 'Samsung Galaxy S24 FE 5G 8/256Gb Gray',             price: 289990, oldPrice: 330000, rating: 4.7, reviews: 145, merchant: 'Samsung KZ', category: 'смартфоны', tags: ['смартфон','samsung','s24','телефон','galaxy'], url: 'https://halykmarket.kz/category/smartfony/smartfon-samsung-galaxy-s24-fe-5g?sku=8256gb_gray' },
  { sku: 'SM-004', name: 'Apple iPhone 15 128Gb Black',                        price: 369990, oldPrice: 420000, rating: 4.9, reviews: 534, merchant: 'iSpace KZ',  category: 'смартфоны', tags: ['смартфон','iphone','apple','айфон','телефон','iphone15'], url: 'https://halykmarket.kz/category/smartfony/smartfon-apple-iphone-15?sku=128gb_black' },
  { sku: 'SM-005', name: 'Apple iPhone 15 Pro 256Gb Natural Titanium',         price: 489990, oldPrice: 550000, rating: 4.9, reviews: 287, merchant: 'iSpace KZ',  category: 'смартфоны', tags: ['смартфон','iphone','apple','айфон','телефон','iphone15','pro'], url: 'https://halykmarket.kz/category/smartfony/smartfon-apple-iphone-15-pro?sku=256gb_natural-titanium' },
  { sku: 'SM-006', name: 'Apple iPhone 16 Pro Max 256Gb Black Titanium',       price: 649990, oldPrice: 720000, rating: 5.0, reviews: 89,  merchant: 'iSpace KZ',  category: 'смартфоны', tags: ['смартфон','iphone','apple','айфон','телефон','iphone16','pro','max'], url: 'https://halykmarket.kz/category/smartfony/smartfon-apple-iphone-16-pro-max?sku=8256gb_blacktitanium' },

  // ── Телевизоры ───────────────────────────────────────────────────────────
  { sku: 'TV-001', name: 'LG OLED55A3RLA 55" 4K OLED Smart TV',               price: 440990, oldPrice: 540000, rating: 4.8, reviews: 203, merchant: 'LG Electronics', category: 'телевизоры', tags: ['телевизор','lg','oled','55','смарт','4k','тв'], url: 'https://halykmarket.kz/category/televizori/televizor-lg-oled55a3rla-55-chernyj' },
  { sku: 'TV-002', name: 'Samsung UE55CU7100UXUZ 55" 4K UHD Smart TV',        price: 249990, oldPrice: 299990, rating: 4.6, reviews: 178, merchant: 'Samsung KZ',   category: 'телевизоры', tags: ['телевизор','samsung','55','смарт','4k','тв'], url: 'https://halykmarket.kz/category/televizori/televizor-samsung-ue55cu7100uxuz-55' },
  { sku: 'TV-003', name: 'Samsung QE55QN700BUXCE 55" Neo QLED 8K',            price: 699990, oldPrice: 850000, rating: 4.9, reviews: 67,  merchant: 'Samsung KZ',   category: 'телевизоры', tags: ['телевизор','samsung','qled','55','8k','тв'], url: 'https://halykmarket.kz/category/televizori/televizor-samsung-qe55qn700buxce-55' },

  // ── Холодильники ─────────────────────────────────────────────────────────
  { sku: 'RF-001', name: 'Samsung RB31FERNDWW/WT Белый',                       price: 188999, oldPrice: 209999, rating: 4.7, reviews: 321, merchant: 'Samsung KZ',  category: 'холодильники', tags: ['холодильник','samsung','двухкамерный'], url: 'https://halykmarket.kz/category/holodilniki' },
  { sku: 'RF-002', name: 'LG GC-B459MEWM Бежевый',                            price: 197100, oldPrice: 219000, rating: 4.8, reviews: 256, merchant: 'LG Electronics', category: 'холодильники', tags: ['холодильник','lg','двухкамерный'], url: 'https://halykmarket.kz/category/holodilniki' },
  { sku: 'RF-003', name: 'LG GC-B399SQCL Белый',                              price: 125987, oldPrice: 139986, rating: 4.6, reviews: 189, merchant: 'LG Electronics', category: 'холодильники', tags: ['холодильник','lg','двухкамерный'], url: 'https://halykmarket.kz/category/holodilniki' },
  { sku: 'RF-004', name: 'Samsung RS80F65J1FWT Side-by-Side Чёрный',           price: 769990, oldPrice: 944990, rating: 4.9, reviews: 78,  merchant: 'Samsung KZ',  category: 'холодильники', tags: ['холодильник','samsung','side-by-side','большой'], url: 'https://halykmarket.kz/category/holodilniki' },

  // ── Стиральные машины ────────────────────────────────────────────────────
  { sku: 'WM-001', name: 'Samsung WW90DG6G94LBLD 9кг 1400об',                 price: 349990, oldPrice: 384990, rating: 4.8, reviews: 145, merchant: 'Samsung KZ',  category: 'стиральные машины', tags: ['стиральная','машина','стиралка','samsung','автомат'], url: 'https://halykmarket.kz/category/stiralnie-mashini/stiralnaya-mashina-samsung-ww70ag5s21eeld-belyy' },
  { sku: 'WM-002', name: 'Haier HW80-B14979 8кг Белая',                       price: 189990, oldPrice: 220000, rating: 4.6, reviews: 98,  merchant: 'Haier KZ',    category: 'стиральные машины', tags: ['стиральная','машина','стиралка','haier','автомат'], url: 'https://halykmarket.kz/category/stiralnie-mashini/stiralnaja-mashina-haier-hw80-b14979-belyj' },
  { sku: 'WM-003', name: 'LG F4V3ES6W 9кг Белая Steam',                       price: 279990, oldPrice: 320000, rating: 4.9, reviews: 167, merchant: 'LG Electronics', category: 'стиральные машины', tags: ['стиральная','машина','стиралка','lg','автомат'], url: 'https://halykmarket.kz/category/stiralnie-mashini/stiralnaja-mashina-lg-f4v3es6w' },

  // ── Ноутбуки ─────────────────────────────────────────────────────────────
  { sku: 'NB-001', name: 'Lenovo IdeaPad Slim 3 15IRU8 512Gb Серый',          price: 269990, oldPrice: 310000, rating: 4.7, reviews: 234, merchant: 'Lenovo KZ',   category: 'ноутбуки', tags: ['ноутбук','lenovo','ideapad','laptop'], url: 'https://halykmarket.kz/category/noutbuki/noutbuk-lenovo-ideapad-slim-3-15iru8-82x7009crk-512gb-seryj' },
  { sku: 'NB-002', name: 'Lenovo LOQ 15IRH8 Gaming 512Gb Серый',              price: 459990, oldPrice: 510000, rating: 4.8, reviews: 156, merchant: 'Lenovo KZ',   category: 'ноутбуки', tags: ['ноутбук','lenovo','loq','gaming','игровой','laptop'], url: 'https://halykmarket.kz/category/noutbuki/-lenovo-loq-15irh8-82xv00qvrk-' },
  { sku: 'NB-003', name: 'Lenovo ThinkPad X1 Carbon Gen 11 14" 1Tb Black',   price: 899990, oldPrice: 990000, rating: 4.9, reviews: 45,  merchant: 'Lenovo KZ',   category: 'ноутбуки', tags: ['ноутбук','lenovo','thinkpad','x1','бизнес','laptop'], url: 'https://halykmarket.kz/category/noutbuki/noutbuk-lenovo-thinkpad-x1-21hm005prt-14-1tb-black' },

  // ── Пылесосы ─────────────────────────────────────────────────────────────
  { sku: 'VC-001', name: 'Xiaomi Robot Vacuum X20+ Белый',                     price: 218688, oldPrice: 259990, rating: 4.8, reviews: 189, merchant: 'Xiaomi KZ',   category: 'пылесосы', tags: ['пылесос','робот','xiaomi','робот-пылесос'], url: 'https://halykmarket.kz/category/pilesosi/robot-pylesos-xiaomi-x20-belyj' },
  { sku: 'VC-002', name: 'Xiaomi Robot Vacuum S20+ Чёрный',                   price: 189990, oldPrice: 220000, rating: 4.7, reviews: 134, merchant: 'Xiaomi KZ',   category: 'пылесосы', tags: ['пылесос','робот','xiaomi','робот-пылесос'], url: 'https://halykmarket.kz/category/pilesosi/robot-pylesos-xiaomi-robot-vacuum-s20-chernyy' },

  // ── Кроссовки ────────────────────────────────────────────────────────────
  { sku: 'SN-001', name: 'Nike Air Max 97 Futura р.42 Белые',                  price: 74900,  oldPrice: 93520,  rating: 4.8, reviews: 78,  merchant: 'Sport House', category: 'кроссовки', tags: ['кроссовки','nike','air max','обувь'], url: 'https://halykmarket.kz/category/muzhskie-krossovki-i-kedy' },
  { sku: 'SN-002', name: 'Adidas Ultrabounce ID2253 р.42 Чёрные',             price: 39990,  oldPrice: 52000,  rating: 4.6, reviews: 112, merchant: 'Sport House', category: 'кроссовки', tags: ['кроссовки','adidas','обувь'], url: 'https://halykmarket.kz/category/muzhskie-krossovki-i-kedy/krossovki-adidas-ultrabounce-id2253?sku=8_chernyy' },
  { sku: 'SN-003', name: 'Adidas Ozweego GY6180 р.43 Чёрные',                price: 52990,  oldPrice: 68000,  rating: 4.7, reviews: 89,  merchant: 'Sport House', category: 'кроссовки', tags: ['кроссовки','adidas','ozweego','обувь'], url: 'https://halykmarket.kz/category/muzhskie-krossovki-i-kedy/krossovki-adidas-ozweego-gy6180?sku=43_chernye' },
];

const DRUGS = [
  { sku: 'AP-001', name: 'Азитромицин капс. 500мг №6', price: 2890, rx: true,  pharmacy: 'Europharma (1.2 км)', pickup: 'сегодня' },
  { sku: 'AP-002', name: 'Парацетамол таб. 500мг №10',  price: 350,  rx: false, pharmacy: 'Europharma (1.2 км)', pickup: 'сегодня' },
  { sku: 'AP-003', name: 'Ибупрофен таб. 400мг №20',    price: 680,  rx: false, pharmacy: 'Maxi Pharm (2.1 км)', pickup: 'сегодня' },
  { sku: 'AP-004', name: 'Амоксициллин капс. 500мг №16',price: 1450, rx: true,  pharmacy: 'Amangeldy Pharm (0.8 км)', pickup: 'сегодня' },
  { sku: 'AP-005', name: 'Ксарелто таб. 10мг №10',      price: 8900, rx: true,  pharmacy: 'Europharma (1.2 км)', pickup: 'завтра' },
];

function executeTool(name, input) {
  if (name === 'market_search') {
    const q = String(input.query || '').toLowerCase();
    const max = input.maxPrice;
    const words = q.split(/\s+/).filter(w => w.length > 2);
    let results = CATALOG.filter(item =>
      item.tags.some(tag => words.some(w => tag.includes(w) || w.includes(tag))) ||
      item.name.toLowerCase().split(/\s+/).some(w => words.some(qw => w.includes(qw))) ||
      item.category && words.some(w => item.category.includes(w))
    );
    if (!results.length) results = CATALOG.slice(0, 6);
    if (max) results = results.filter(i => i.price <= max);
    results.sort((a, b) => (b.rating * Math.log(b.reviews + 1)) - (a.rating * Math.log(a.reviews + 1)));
    return { results: results.slice(0, input.limit || 3) };
  }
  if (name === 'market_add_to_cart') {
    const existing = state.cart.find(i => i.sku === input.sku);
    if (existing) { existing.quantity += (input.quantity || 1); }
    else { state.cart.push({ sku: input.sku, name: input.name, price: input.price, quantity: input.quantity || 1 }); }
    if (typeof updateCartBadge === 'function') updateCartBadge();
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
          <div class="product-name">${item.url ? `<a href="${item.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline dotted">${escHtml(item.name)}</a>` : escHtml(item.name)}</div>
          <div class="product-meta">⭐ ${item.rating} · ${item.reviews} отзывов · ${item.merchant}</div>
        </div>
        <div class="product-price-block">
          ${item.oldPrice ? `<div class="product-old-price">${item.oldPrice.toLocaleString('ru-RU')} ₸</div>` : ''}
          <div class="product-price">${item.price.toLocaleString('ru-RU')} ₸</div>
        </div>
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
      updateCartBadge();
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

// ── Cart ──────────────────────────────────────────────────────────────────────
const cartModal   = document.getElementById('cartModal');
const cartBadge   = document.getElementById('cartBadge');
const cartItems   = document.getElementById('cartItems');
const cartEmpty   = document.getElementById('cartEmpty');
const cartFooter  = document.getElementById('cartFooter');

function updateCartBadge() {
  const total = state.cart.reduce((s, i) => s + i.quantity, 0);
  cartBadge.textContent = total;
  cartBadge.style.display = total > 0 ? 'flex' : 'none';
}

function renderCart() {
  cartItems.innerHTML = '';
  if (!state.cart.length) {
    cartEmpty.style.display = 'block';
    cartFooter.style.display = 'none';
    return;
  }
  cartEmpty.style.display = 'none';
  cartFooter.style.display = 'block';

  const icons = { market: 'ti-building-store', appteka: 'ti-pill', travel: 'ti-plane' };

  state.cart.forEach((item, idx) => {
    const icon = icons[item.vertical || 'market'] || 'ti-box';
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div class="cart-item-icon"><i class="ti ${icon}"></i></div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.name)}</div>
        <div class="cart-item-merchant">${(item.price).toLocaleString('ru-RU')} ₸ за шт.</div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" data-idx="${idx}" data-delta="-1">−</button>
        <span class="qty-val">${item.quantity}</span>
        <button class="qty-btn" data-idx="${idx}" data-delta="1">+</button>
      </div>
      <div class="cart-item-price">${(item.price * item.quantity).toLocaleString('ru-RU')} ₸</div>
      <button class="cart-item-remove" data-idx="${idx}"><i class="ti ti-trash"></i></button>
    `;
    cartItems.appendChild(div);
  });

  // Qty buttons
  cartItems.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      state.cart[idx].quantity += +btn.dataset.delta;
      if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
      renderCart();
      updateCartBadge();
    });
  });

  // Remove buttons
  cartItems.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.cart.splice(+btn.dataset.idx, 1);
      renderCart();
      updateCartBadge();
    });
  });

  // Totals
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const delivery = subtotal > 0 ? 500 : 0;
  document.getElementById('cartSubtotal').textContent = subtotal.toLocaleString('ru-RU') + ' ₸';
  document.getElementById('cartDelivery').textContent = delivery.toLocaleString('ru-RU') + ' ₸';
  document.getElementById('cartTotal').textContent = (subtotal + delivery).toLocaleString('ru-RU') + ' ₸';
}

document.getElementById('cartBtn').addEventListener('click', () => {
  renderCart();
  cartModal.style.display = 'flex';
});
document.getElementById('cartClose').addEventListener('click', () => cartModal.style.display = 'none');

// ── Checkout button → PIN modal ────────────────────────────────────────────
const pinModal = document.getElementById('pinModal');
let pinValue = '';

function openPin() {
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const total = subtotal + 500;
  document.getElementById('pinAmount').textContent = total.toLocaleString('ru-RU') + ' ₸';
  pinValue = '';
  updatePinDisplay();
  cartModal.style.display = 'none';
  pinModal.style.display = 'flex';
}

function updatePinDisplay() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('d' + i).classList.toggle('filled', i < pinValue.length);
  }
}

document.getElementById('checkoutBtn').addEventListener('click', openPin);
document.getElementById('pinCancel').addEventListener('click', () => { pinModal.style.display = 'none'; });
document.getElementById('pinClear').addEventListener('click', () => { pinValue = ''; updatePinDisplay(); });
document.getElementById('pinBack').addEventListener('click', () => { pinValue = pinValue.slice(0, -1); updatePinDisplay(); });

document.querySelectorAll('.pin-key[data-v]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pinValue.length >= 4) return;
    pinValue += btn.dataset.v;
    updatePinDisplay();
    if (pinValue.length === 4) {
      // Any 4-digit PIN is "correct" in the demo
      setTimeout(confirmPayment, 300);
    }
  });
});

function confirmPayment() {
  pinModal.style.display = 'none';
  const method = document.querySelector('input[name="payMethod"]:checked')?.value || 'card';
  const methodLabels = { card: 'Карта •• 6411', bnpl: 'Рассрочка 0-0-12', widget: 'Halyk Widget' };
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const total = subtotal + 500;
  const orderId = 'HM-' + Date.now().toString(36).toUpperCase();

  document.getElementById('successText').textContent =
    `Оплата ${total.toLocaleString('ru-RU')} ₸ через ${methodLabels[method]}. Доставка: сегодня–завтра.`;
  document.getElementById('orderId').textContent = 'Заказ № ' + orderId;
  document.getElementById('successModal').style.display = 'flex';

  // Add agent message about successful order
  const summary = state.cart.map(i => `${i.name} ×${i.quantity}`).join(', ');
  const agentMsg = `✅ Заказ ${orderId} оформлен! ${summary}. Сумма: ${total.toLocaleString('ru-RU')} ₸. Ожидайте доставку.`;
  addAgentBubble(agentMsg, [], null);
  state.messages.push({ role: 'assistant', content: agentMsg, ts: Date.now() });

  state.cart = [];
  updateCartBadge();
}

document.getElementById('successClose').addEventListener('click', () => {
  document.getElementById('successModal').style.display = 'none';
});

// ── Clear chat ───────────────────────────────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!state.messages.length) return;
  if (!confirm('Очистить историю чата?')) return;
  state.messages = [];
  state.cart = [];
  updateCartBadge();
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
