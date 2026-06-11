import { ClientMemory, PurchaseRecord, Preference, SessionContext } from '../types';

// FR-106, FR-302, FR-303
// Phase 0: in-memory store. Replace with Redis (sessions) + pgvector (memory) in Phase 4.
class MemoryStore {
  private clientMemories = new Map<string, ClientMemory>();
  private sessions = new Map<string, SessionContext>();

  // ── Client memory ────────────────────────────────────────────────────
  getMemory(clientId: string): ClientMemory {
    if (!this.clientMemories.has(clientId)) {
      this.clientMemories.set(clientId, {
        clientId,
        preferences: [],
        recentPurchases: [],
        frequentSkus: [],
      });
    }
    return this.clientMemories.get(clientId)!;
  }

  addPurchase(clientId: string, purchase: PurchaseRecord): void {
    const mem = this.getMemory(clientId);
    mem.recentPurchases.unshift(purchase);
    // Keep 180 days / max 500 records
    mem.recentPurchases = mem.recentPurchases.slice(0, 500);

    // Update frequent SKUs
    for (const item of purchase.items) {
      if (!mem.frequentSkus.includes(item.sku)) {
        mem.frequentSkus.push(item.sku);
      }
    }

    this.clientMemories.set(clientId, mem);
  }

  addPreference(clientId: string, pref: Preference): void {
    const mem = this.getMemory(clientId);
    const idx = mem.preferences.findIndex(p => p.key === pref.key);
    if (idx >= 0) {
      mem.preferences[idx] = pref;
    } else {
      mem.preferences.push(pref);
    }
    this.clientMemories.set(clientId, mem);
  }

  // FR-106: "как обычно" — finds last purchase of a given category/name
  findUsual(clientId: string, hint: string): PurchaseRecord | undefined {
    const mem = this.getMemory(clientId);
    return mem.recentPurchases.find(p =>
      p.items.some(i => i.name.toLowerCase().includes(hint.toLowerCase()))
    );
  }

  // Right to be forgotten (FR-501, NFR-5)
  clearMemory(clientId: string): void {
    this.clientMemories.delete(clientId);
  }

  // ── Session context ───────────────────────────────────────────────────
  getSession(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  saveSession(session: SessionContext): void {
    this.sessions.set(session.sessionId, session);
  }

  pruneExpiredSessions(ttlMinutes = 30): void {
    const cutoff = Date.now() - ttlMinutes * 60_000;
    for (const [id, s] of this.sessions) {
      if (new Date(s.lastActivityAt).getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}

export const memoryStore = new MemoryStore();
