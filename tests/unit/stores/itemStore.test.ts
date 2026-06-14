import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useItemStore } from '../../../src/renderer/stores/itemStore';
import type { ItemDecrypted } from '../../../src/shared/types';

const mockElectron = {
  items: {
    getByFolder: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggleFavorite: vi.fn(),
    search: vi.fn(),
  },
};

vi.stubGlobal('window', {
  electron: mockElectron,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

function makeItem(id: string, title: string, folderId: string = 'f1'): ItemDecrypted {
  const now = Date.now();
  return {
    id,
    folderId,
    title,
    username: '',
    password: '',
    url: '',
    notes: null,
    emoji: null,
    coverImage: null,
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
    sortOrder: 0,
    tags: [],
  };
}

describe('itemStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useItemStore.setState({
      items: {},
      itemIds: [],
      currentFolderId: null,
      selectedItemId: null,
      isLoading: false,
      error: null,
    });
  });

  describe('initial state', () => {
    it('should start with empty items', () => {
      const state = useItemStore.getState();
      expect(state.items).toEqual({});
      expect(state.itemIds).toEqual([]);
    });

    it('should start with no selection', () => {
      expect(useItemStore.getState().selectedItemId).toBeNull();
    });

    it('should start with no current folder', () => {
      expect(useItemStore.getState().currentFolderId).toBeNull();
    });
  });

  describe('setSelectedItem', () => {
    it('should set selectedItemId', () => {
      useItemStore.getState().setSelectedItem('item-1');
      expect(useItemStore.getState().selectedItemId).toBe('item-1');
    });

    it('should clear selectedItemId with null', () => {
      useItemStore.setState({ selectedItemId: 'item-1' });
      useItemStore.getState().setSelectedItem(null);
      expect(useItemStore.getState().selectedItemId).toBeNull();
    });
  });

  describe('loadItems', () => {
    it('should load items and populate the store', async () => {
      const items = [makeItem('i1', 'Item One'), makeItem('i2', 'Item Two')];
      mockElectron.items.getByFolder.mockResolvedValue(items);

      await useItemStore.getState().loadItems('f1');

      const state = useItemStore.getState();
      expect(state.currentFolderId).toBe('f1');
      expect(state.items).toHaveProperty('i1');
      expect(state.items).toHaveProperty('i2');
      expect(state.itemIds).toEqual(['i1', 'i2']);
      expect(state.isLoading).toBe(false);
    });

    it('should handle empty folder', async () => {
      mockElectron.items.getByFolder.mockResolvedValue([]);

      await useItemStore.getState().loadItems('empty');

      const state = useItemStore.getState();
      expect(state.itemIds).toEqual([]);
    });

    it('should set error on failure', async () => {
      mockElectron.items.getByFolder.mockRejectedValue(new Error('DB error'));

      await useItemStore.getState().loadItems('f1');

      expect(useItemStore.getState().error).toBe('DB error');
      expect(useItemStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadItemById', () => {
    it('should load single item and add to store', async () => {
      const item = makeItem('single', 'Single Item');
      mockElectron.items.getById.mockResolvedValue(item);

      await useItemStore.getState().loadItemById('single');

      const state = useItemStore.getState();
      expect(state.items['single']).toEqual(item);
      expect(state.itemIds).toContain('single');
    });

    it('should not add duplicate itemIds', async () => {
      useItemStore.setState({
        items: { single: makeItem('single', 'Single') },
        itemIds: ['single'],
      });

      const updated = { ...makeItem('single', 'Updated Single') };
      mockElectron.items.getById.mockResolvedValue(updated);

      await useItemStore.getState().loadItemById('single');

      expect(useItemStore.getState().itemIds).toEqual(['single']);
      expect(useItemStore.getState().items['single'].title).toBe('Updated Single');
    });

    it('should set error on failure', async () => {
      mockElectron.items.getById.mockRejectedValue(new Error('Not found'));

      await useItemStore.getState().loadItemById('missing');

      expect(useItemStore.getState().error).toBe('Not found');
    });
  });

  describe('createItem', () => {
    it('should create item and add to store', async () => {
      const created = makeItem('new', 'New Item', 'f1');
      mockElectron.items.create.mockResolvedValue(created);

      useItemStore.setState({ currentFolderId: 'f1' });

      const result = await useItemStore.getState().createItem('f1', {
        title: 'New Item',
        username: 'user',
      });

      expect(result).toEqual(created);
      expect(useItemStore.getState().items['new']).toEqual(created);
      expect(useItemStore.getState().itemIds).toContain('new');
    });

    it('should not add to itemIds if current folder differs', async () => {
      const created = makeItem('other', 'Other', 'f2');
      mockElectron.items.create.mockResolvedValue(created);

      useItemStore.setState({ currentFolderId: 'f1' });

      await useItemStore.getState().createItem('f2', { title: 'Other' });

      // currentFolderId is f1, but we created in f2, so shouldn't add to ids
      expect(useItemStore.getState().itemIds).not.toContain('other');
    });

    it('should return null and set error on failure', async () => {
      mockElectron.items.create.mockRejectedValue(new Error('DB error'));

      const result = await useItemStore.getState().createItem('f1', { title: 'Fail' });

      expect(result).toBeNull();
      expect(useItemStore.getState().error).toBe('DB error');
    });
  });

  describe('updateItem', () => {
    it('should update item in store', async () => {
      const original = makeItem('i1', 'Original');
      useItemStore.setState({
        items: { i1: original },
        itemIds: ['i1'],
      });

      const updated = { ...original, title: 'Updated', username: 'newuser' };
      mockElectron.items.update.mockResolvedValue(updated);

      await useItemStore.getState().updateItem('i1', { title: 'Updated', username: 'newuser' });

      const state = useItemStore.getState();
      expect(state.items['i1'].title).toBe('Updated');
      expect(state.items['i1'].username).toBe('newuser');
    });

    it('should set error on failure', async () => {
      mockElectron.items.update.mockRejectedValue(new Error('DB error'));

      await useItemStore.getState().updateItem('i1', { title: 'X' });

      expect(useItemStore.getState().error).toBe('DB error');
    });
  });

  describe('deleteItem', () => {
    it('should delete item from store', async () => {
      useItemStore.setState({
        items: { i1: makeItem('i1', 'Delete Me') },
        itemIds: ['i1'],
      });
      mockElectron.items.delete.mockResolvedValue(undefined);

      await useItemStore.getState().deleteItem('i1');

      const state = useItemStore.getState();
      expect(state.items).not.toHaveProperty('i1');
      expect(state.itemIds).not.toContain('i1');
    });

    it('should clear selection if deleting selected item', async () => {
      useItemStore.setState({
        items: { i1: makeItem('i1', 'Selected') },
        itemIds: ['i1'],
        selectedItemId: 'i1',
      });
      mockElectron.items.delete.mockResolvedValue(undefined);

      await useItemStore.getState().deleteItem('i1');

      expect(useItemStore.getState().selectedItemId).toBeNull();
    });

    it('should set error on failure', async () => {
      mockElectron.items.delete.mockRejectedValue(new Error('DB error'));

      await useItemStore.getState().deleteItem('i1');

      expect(useItemStore.getState().error).toBe('DB error');
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle favorite and update in store', async () => {
      const original = makeItem('i1', 'Item');
      useItemStore.setState({
        items: { i1: original },
        itemIds: ['i1'],
      });

      const toggled = { ...original, isFavorite: true };
      mockElectron.items.toggleFavorite.mockResolvedValue(toggled);

      await useItemStore.getState().toggleFavorite('i1');

      expect(useItemStore.getState().items['i1'].isFavorite).toBe(true);
    });

    it('should set error on failure', async () => {
      mockElectron.items.toggleFavorite.mockRejectedValue(new Error('DB error'));

      await useItemStore.getState().toggleFavorite('i1');

      expect(useItemStore.getState().error).toBe('DB error');
    });
  });

  describe('searchItems', () => {
    it('should search and replace items in store', async () => {
      const results = [makeItem('r1', 'Result One'), makeItem('r2', 'Result Two')];
      mockElectron.items.search.mockResolvedValue(results);

      await useItemStore.getState().searchItems('query');

      const state = useItemStore.getState();
      expect(state.itemIds).toEqual(['r1', 'r2']);
      expect(state.items).toHaveProperty('r1');
      expect(state.items).toHaveProperty('r2');
      expect(state.isLoading).toBe(false);
    });

    it('should reload items when query is empty', async () => {
      useItemStore.setState({ currentFolderId: 'f1' });
      const items = [makeItem('back', 'Back to folder')];
      mockElectron.items.getByFolder.mockResolvedValue(items);

      await useItemStore.getState().searchItems('');

      expect(mockElectron.items.getByFolder).toHaveBeenCalledWith('f1');
      expect(useItemStore.getState().itemIds).toContain('back');
    });

    it('should set error on failure', async () => {
      mockElectron.items.search.mockRejectedValue(new Error('Search failed'));

      await useItemStore.getState().searchItems('fail');

      expect(useItemStore.getState().error).toBe('Search failed');
      expect(useItemStore.getState().isLoading).toBe(false);
    });
  });

  describe('clearSearch', () => {
    it('should reload items for current folder', async () => {
      useItemStore.setState({ currentFolderId: 'f1' });
      const items = [makeItem('reloaded', 'Reloaded')];
      mockElectron.items.getByFolder.mockResolvedValue(items);

      await useItemStore.getState().clearSearch();

      expect(mockElectron.items.getByFolder).toHaveBeenCalledWith('f1');
      expect(useItemStore.getState().itemIds).toContain('reloaded');
    });

    it('should not reload if no current folder', async () => {
      useItemStore.setState({ currentFolderId: null });

      await useItemStore.getState().clearSearch();

      expect(mockElectron.items.getByFolder).not.toHaveBeenCalled();
    });
  });
});
