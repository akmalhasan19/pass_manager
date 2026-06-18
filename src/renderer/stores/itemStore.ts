import { create } from 'zustand';
import { produce } from 'immer';
import type { Item, ItemDecrypted, TotpConfig } from '../../shared/types';

export interface ItemState {
  items: Record<string, Item | ItemDecrypted>;
  itemIds: string[];
  currentFolderId: string | null;
  selectedItemId: string | null;
  isLoading: boolean;
  error: string | null;

  loadItems: (folderId: string) => Promise<void>;
  loadItemById: (id: string) => Promise<void>;
  createItem: (
    folderId: string,
    fields: {
      title: string;
      username?: string;
      password?: string | null;
      url?: string;
      notes?: string | null;
      emoji?: string | null;
      coverImage?: string | null;
      otpConfig?: TotpConfig | null;
    },
  ) => Promise<ItemDecrypted | null>;
  updateItem: (
    id: string,
    fields: {
      title?: string;
      username?: string;
      password?: string | null;
      url?: string;
      notes?: string | null;
      emoji?: string | null;
      coverImage?: string | null;
      isFavorite?: boolean;
      sortOrder?: number;
      otpConfig?: TotpConfig | null;
    },
  ) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setSelectedItem: (id: string | null) => void;
  searchItems: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearSensitiveData: () => void;
  reset: () => void;
}

export const useItemStore = create<ItemState>((set, get) => ({
  items: {},
  itemIds: [],
  currentFolderId: null,
  selectedItemId: null,
  isLoading: false,
  error: null,

  loadItems: async (folderId) => {
    set({ isLoading: true, error: null, currentFolderId: folderId });
    try {
      const result = await window.electron.items.getByFolder(folderId);
      if (!result.success) throw new Error(result.error || 'Failed to load items');
      set(
        produce((state: ItemState) => {
          state.items = {};
          state.itemIds = [];
          for (const item of result.data) {
            state.items[item.id] = item;
            state.itemIds.push(item.id);
          }
          state.isLoading = false;
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load items';
      set({ isLoading: false, error: message });
    }
  },

  loadItemById: async (id) => {
    try {
      const result = await window.electron.items.getById(id);
      if (!result.success) throw new Error(result.error || 'Failed to load item');
      const item = result.data;
      if (item) {
        set(
          produce((state: ItemState) => {
            state.items[item.id] = item;
            if (!state.itemIds.includes(item.id)) {
              state.itemIds.push(item.id);
            }
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load item';
      set({ error: message });
    }
  },

  createItem: async (folderId, fields) => {
    set({ error: null });
    try {
      const result = await window.electron.items.create(folderId, fields);
      if (!result.success) throw new Error(result.error || 'Failed to create item');
      const item = result.data;
      set(
        produce((state: ItemState) => {
          state.items[item.id] = item;
          if (state.currentFolderId === folderId) {
            state.itemIds.push(item.id);
          }
        }),
      );
      return item;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create item';
      set({ error: message });
      return null;
    }
  },

  updateItem: async (id, fields) => {
    set({ error: null });
    try {
      const result = await window.electron.items.update(id, fields);
      if (!result.success) throw new Error(result.error || 'Failed to update item');
      const updated = result.data;
      if (updated) {
        set(
          produce((state: ItemState) => {
            state.items[id] = updated;
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update item';
      set({ error: message });
    }
  },

  deleteItem: async (id) => {
    set({ error: null });
    try {
      await window.electron.items.delete(id);
      set(
        produce((state: ItemState) => {
          delete state.items[id];
          state.itemIds = state.itemIds.filter((itemId) => itemId !== id);
          if (state.selectedItemId === id) {
            state.selectedItemId = null;
          }
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete item';
      set({ error: message });
    }
  },

  toggleFavorite: async (id) => {
    try {
      const result = await window.electron.items.toggleFavorite(id);
      if (!result.success) throw new Error(result.error || 'Failed to toggle favorite');
      const updated = result.data;
      if (updated) {
        set(
          produce((state: ItemState) => {
            state.items[id] = updated;
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle favorite';
      set({ error: message });
    }
  },

  setSelectedItem: (id) => set({ selectedItemId: id }),

  searchItems: async (query) => {
    if (!query.trim()) {
      get().loadItems(get().currentFolderId || '');
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const result = await window.electron.items.search(query);
      if (!result.success) throw new Error(result.error || 'Search failed');
      set(
        produce((state: ItemState) => {
          state.items = {};
          state.itemIds = [];
          for (const item of result.data) {
            state.items[item.id] = item;
            state.itemIds.push(item.id);
          }
          state.isLoading = false;
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search items';
      set({ isLoading: false, error: message });
    }
  },

  clearSearch: () => {
    const { currentFolderId } = get();
    if (currentFolderId) {
      get().loadItems(currentFolderId);
    }
  },

  clearSensitiveData: () => {
    // SECURITY: Overwrite decrypted passwords and notes in all cached items
    // before releasing references. V8 strings are immutable, but overwriting
    // the property ensures the old value becomes unreachable for GC.
    //
    // OTP secrets are NEVER stored in the renderer — the `otp.secret` field
    // is always an empty string. OTP codes are generated in the main process
    // via IPC (OTP_GENERATE channel), so the plaintext secret never persists
    // in Zustand or any renderer state.
    const { items } = get();
    for (const id of Object.keys(items)) {
      const item = items[id];
      if ('password' in item && typeof item.password === 'string') {
        (item as ItemDecrypted).password = '';
      }
      if ('notes' in item && typeof item.notes === 'string') {
        (item as ItemDecrypted).notes = null;
      }
      // SECURITY: Ensure OTP secret is wiped even if somehow present
      if ('otp' in item && item.otp && typeof item.otp.secret === 'string' && item.otp.secret) {
        item.otp.secret = '';
      }
    }
    get().reset();
  },

  reset: () =>
    set({
      items: {},
      itemIds: [],
      currentFolderId: null,
      selectedItemId: null,
      isLoading: false,
      error: null,
    }),
}));
