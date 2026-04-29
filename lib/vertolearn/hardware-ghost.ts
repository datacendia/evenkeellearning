// ─────────────────────────────────────────────────────────────────────────────
// lib/vertolearn/hardware-ghost.ts
//
// Offline-first sync scaffold. Wraps an IndexedDB store (via `idb`) holding
// queued CRTs and pending operations, and listens to `online` / `offline`
// events to flush the queue when connectivity returns.
//
// HONESTY
// ───────
// The "burst to cloud" path is a `setTimeout(100)` that pretends to upload.
// There is no server. Replace `flushQueueToCloud` with a real fetch call
// when a back-end exists. See HONESTY.md §2.3.
//
// The IndexedDB schema name is intentionally left as `LuminaryOfflineDB`
// (a previous product name) so that any developer who already has local
// data on disk does not lose it on rename. New deployments should rename.
// ─────────────────────────────────────────────────────────────────────────────

import { openDB, DBSchema, IDBPDatabase } from "idb";
import { CognitiveReasoningTrace } from "../types";

interface LuminaryOfflineDB extends DBSchema {
  syncQueue: {
    key: string;
    value: SyncQueueItem;
  };
  localTraces: {
    key: string;
    value: CognitiveReasoningTrace;
  };
  localPatterns: {
    key: string;
    value: any;
  };
}

interface SyncQueueItem {
  id: string;
  type: "crt" | "ipa" | "career_dna";
  data: any;
  timestamp: number;
  encrypted: boolean;
  syncAttempts: number;
}

export class HardwareGhostProtocol {
  private db: IDBPDatabase<LuminaryOfflineDB> | null = null;
  private isOnline: boolean = true;
  private syncInterval: number = 30000; // 30 seconds
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private localSLMActive: boolean = false;

  async initialize(): Promise<void> {
    this.db = await openDB<LuminaryOfflineDB>("LuminaryOfflineDB", 1, {
      upgrade(db) {
        db.createObjectStore("syncQueue", { keyPath: "id" });
        db.createObjectStore("localTraces", { keyPath: "sessionId" });
        db.createObjectStore("localPatterns", { keyPath: "sessionId" });
      },
    });

    // Monitor online status
    window.addEventListener("online", () => this.handleOnline());
    window.addEventListener("offline", () => this.handleOffline());

    // Start sync loop
    this.startSyncLoop();
  }

  private handleOnline = (): void => {
    this.isOnline = true;
    console.log("Hardware Ghost: Back online - initiating sync burst");
    this.syncToCloud();
  };

  private handleOffline = (): void => {
    this.isOnline = false;
    console.log("Hardware Ghost: Offline - activating local SLM");
    this.activateLocalSLM();
  };

  private startSyncLoop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    
    this.syncTimer = setInterval(() => {
      if (this.isOnline) {
        this.syncToCloud();
      }
    }, this.syncInterval);
  }

  async queueForSync(type: SyncQueueItem["type"], data: any): Promise<void> {
    if (!this.db) return;
    
    const item: SyncQueueItem = {
      id: generateId(),
      type,
      data: await this.encryptData(data),
      timestamp: Date.now(),
      encrypted: true,
      syncAttempts: 0,
    };

    await this.db.put("syncQueue", item);

    if (this.isOnline) {
      this.syncToCloud();
    }
  }

  async syncToCloud(): Promise<void> {
    if (!this.isOnline || !this.db) return;

    const pendingItems = await this.db.getAll("syncQueue");
    const failedItems: string[] = [];

    for (const item of pendingItems) {
      try {
        // Simulate cloud sync
        await this.uploadToCloud(item);
        await this.db.delete("syncQueue", item.id);
      } catch (error) {
        item.syncAttempts++;
        if (item.syncAttempts < 5) {
          await this.db.put("syncQueue", item);
        } else {
          failedItems.push(item.id);
        }
      }
    }

    if (failedItems.length > 0) {
      console.warn(`Hardware Ghost: ${failedItems.length} items failed to sync after 5 attempts`);
    }
  }

  private async uploadToCloud(item: SyncQueueItem): Promise<void> {
    // Simulate cloud upload
    // In production, this would be an actual API call
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  private async encryptData(data: any): Promise<string> {
    // Simulate encryption
    // In production, use proper encryption like Web Crypto API
    return JSON.stringify(data);
  }

  private async decryptData(encrypted: string): Promise<any> {
    // Simulate decryption
    return JSON.parse(encrypted);
  }

  async storeLocalTrace(trace: CognitiveReasoningTrace): Promise<void> {
    if (!this.db) return;
    await this.db.put("localTraces", trace);
  }

  async getLocalTrace(sessionId: string): Promise<CognitiveReasoningTrace | undefined> {
    if (!this.db) return undefined;
    return await this.db.get("localTraces", sessionId);
  }

  async getAllLocalTraces(): Promise<CognitiveReasoningTrace[]> {
    if (!this.db) return [];
    return await this.db.getAll("localTraces");
  }

  private activateLocalSLM(): void {
    this.localSLMActive = true;
    console.log("Hardware Ghost: Local SLM activated for offline operation");
  }

  private deactivateLocalSLM(): void {
    this.localSLMActive = false;
    console.log("Hardware Ghost: Local SLM deactivated");
  }

  isUsingLocalSLM(): boolean {
    return this.localSLMActive;
  }

  async getSyncStatus(): Promise<{ isOnline: boolean; queueSize: number }> {
    if (!this.db) return { isOnline: this.isOnline, queueSize: 0 };
    return {
      isOnline: this.isOnline,
      queueSize: await this.db.count("syncQueue"),
    };
  }

  async clearLocalData(): Promise<void> {
    if (!this.db) return;
    await this.db.clear("syncQueue");
    await this.db.clear("localTraces");
    await this.db.clear("localPatterns");
  }

  destroy(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
  }

  // Browser-only methods - wrapped in check
  private isBrowser(): boolean {
    return typeof window !== "undefined";
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function createHardwareGhostProtocol(): HardwareGhostProtocol {
  return new HardwareGhostProtocol();
}
