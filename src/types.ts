// ── Verticals ─────────────────────────────────────────────────────────────
export type Vertical = 'market' | 'appteka' | 'travel' | 'kino' | 'restaurants' | 'general';

// ── Session & Memory ──────────────────────────────────────────────────────
export interface ClientProfile {
  clientId: string;
  name: string;
  language: 'ru' | 'kk';
  kycStatus: 'verified' | 'pending' | 'none';
  age: number;
  city: string;
}

export interface PurchaseRecord {
  purchaseId: string;
  clientId: string;
  vertical: Vertical;
  timestamp: string;
  items: PurchaseItem[];
  total: number;
  currency: 'KZT';
  paymentMethod: 'card' | 'bnpl' | 'halyk_widget';
  status: 'created' | 'paid' | 'delivered' | 'cancelled' | 'refunded';
  metadata: { source: 'agent' | 'manual' | 'recurring' };
}

export interface PurchaseItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  currency: 'KZT';
  merchantId: string;
  category: string;
}

export interface Preference {
  key: string;
  value: string;
  isStrict: boolean; // true for allergies, age restrictions
}

export interface ClientMemory {
  clientId: string;
  preferences: Preference[];
  recentPurchases: PurchaseRecord[];
  frequentSkus: string[];
  budgetLimit?: number;
}

// ── Conversation ──────────────────────────────────────────────────────────
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SessionContext {
  sessionId: string;
  clientId: string;
  messages: Message[];
  currentCart: CartItem[];
  activeVertical?: Vertical;
  lastIntent?: Intent;
  createdAt: string;
  lastActivityAt: string;
}

export interface CartItem {
  vertical: Vertical;
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

// ── Intent ────────────────────────────────────────────────────────────────
export interface Intent {
  vertical: Vertical;
  action: IntentAction;
  confidence: number;
  params: Record<string, unknown>;
}

export type IntentAction =
  | 'search'
  | 'add_to_cart'
  | 'checkout'
  | 'subscribe'
  | 'track_price'
  | 'order_status'
  | 'return'
  | 'general_query';

// ── Tool calls ────────────────────────────────────────────────────────────
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  data: unknown;
  error?: string;
}

// ── Safety ────────────────────────────────────────────────────────────────
export type SafetyVerdict = 'safe' | 'blocked' | 'disclaimer_required';

export interface SafetyCheckResult {
  verdict: SafetyVerdict;
  reason?: string;
  disclaimer?: string;
}

// ── Orchestrator response ─────────────────────────────────────────────────
export interface AgentResponse {
  text: string;
  cartUpdate?: CartItem[];
  requiresConfirmation: boolean;
  confirmationPayload?: unknown;
  handoffToCheckout: boolean;
  suggestedActions?: string[];
  sessionContext: SessionContext;
}
