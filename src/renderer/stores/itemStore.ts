import { create } from 'zustand';
import { produce } from 'immer';
import type { Item } from '../../shared/types';

export interface ItemState {
  items: Record<string, Item>;
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
      passwordEncrypted?: ArrayBuffer | null;
      url?: string;
      notesEncrypted?: ArrayBuffer | null;
      emoji?: string | null;
      coverImage?: string | null;
    },
  ) => Promise<Item | null>;
  updateItem: (
    id: string,
    fields: {
      title?: string;
      username?: string;
      passwordEncrypted?: ArrayBuffer | null;
      url?: string;
      notesEncrypted?: ArrayBuffer | null;
      emoji?: string | null;
      coverImage?: string | null;
      isFavorite?: boolean;
      sortOrder?: number;
    },
  ) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setSelectedItem: (id: string | null) => void;
  searchItems: (query: string) => Promise<void>;
  clearSearch: () => void;
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
      const list = await window.electron.items.getByFolder(folderId);
      set(
        produce((state: ItemState) => {
          state.items = {};
          state.itemIds = [];
          for (const item of list) {
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
      const item = await window.electron.items.getById(id);
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
      const item = await window.electron.items.create(folderId, fields);
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
      const updated = await window.electron.items.update(id, fields);
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
      const updated = await window.electron.items.toggleFavorite(id);
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
      const results = await window.electron.items.search(query);
      set(
        produce((state: ItemState) => {
          state.items = {};
          state.itemIds = [];
          for (const item of results) {
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
}));
