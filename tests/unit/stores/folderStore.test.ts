import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
import { useFolderStore } from '../../../src/renderer/stores/folderStore';
import type { Folder } from '../../../src/shared/types';

enableMapSet();

const mockElectron = {
  folders: {
    getTree: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  },
};

vi.stubGlobal('window', {
  electron: mockElectron,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

function makeFolder(
  id: string,
  name: string,
  parentId: string | null = null,
  children: Folder[] = [],
  emoji?: string,
): Folder {
  const now = Date.now();
  return {
    id,
    parentId,
    name,
    emoji: emoji || null,
    coverImage: null,
    createdAt: now,
    updatedAt: now,
    sortOrder: 0,
    children: children.length > 0 ? children : undefined,
  };
}

describe('folderStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFolderStore.setState({
      folders: [],
      selectedFolderId: null,
      expandedFolderIds: new Set<string>(),
      isLoading: false,
      error: null,
    });
  });

  describe('initial state', () => {
    it('should start with empty folders array', () => {
      expect(useFolderStore.getState().folders).toEqual([]);
    });

    it('should start with no selected folder', () => {
      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });

    it('should start with empty expanded set', () => {
      expect(useFolderStore.getState().expandedFolderIds.size).toBe(0);
    });

    it('should start with isLoading false', () => {
      expect(useFolderStore.getState().isLoading).toBe(false);
    });

    it('should start with no error', () => {
      expect(useFolderStore.getState().error).toBeNull();
    });
  });

  describe('setSelectedFolder', () => {
    it('should set selectedFolderId', () => {
      useFolderStore.getState().setSelectedFolder('folder-1');
      expect(useFolderStore.getState().selectedFolderId).toBe('folder-1');
    });

    it('should clear selectedFolderId with null', () => {
      useFolderStore.setState({ selectedFolderId: 'folder-1' });
      useFolderStore.getState().setSelectedFolder(null);
      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });
  });

  describe('expandFolder / collapseFolder / toggleExpandFolder', () => {
    it('should expand a folder', () => {
      useFolderStore.getState().expandFolder('f1');
      expect(useFolderStore.getState().expandedFolderIds.has('f1')).toBe(true);
    });

    it('should collapse a folder', () => {
      useFolderStore.getState().expandFolder('f1');
      useFolderStore.getState().collapseFolder('f1');
      expect(useFolderStore.getState().expandedFolderIds.has('f1')).toBe(false);
    });

    it('should toggle expand a folder', () => {
      const store = useFolderStore.getState();
      store.toggleExpandFolder('f1');
      expect(useFolderStore.getState().expandedFolderIds.has('f1')).toBe(true);

      useFolderStore.getState().toggleExpandFolder('f1');
      expect(useFolderStore.getState().expandedFolderIds.has('f1')).toBe(false);
    });

    it('should be idempotent expanding an already expanded folder', () => {
      useFolderStore.getState().expandFolder('f1');
      useFolderStore.getState().expandFolder('f1');
      expect(useFolderStore.getState().expandedFolderIds.has('f1')).toBe(true);
    });
  });

  describe('loadTree', () => {
    it('should load folders from IPC and populate state', async () => {
      const tree: Folder[] = [
        makeFolder('root', 'Root', null, [makeFolder('child', 'Child', 'root')]),
      ];
      mockElectron.folders.getTree.mockResolvedValue({ success: true, data: tree });

      await useFolderStore.getState().loadTree();

      const state = useFolderStore.getState();
      expect(state.folders).toEqual(tree);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle empty tree', async () => {
      mockElectron.folders.getTree.mockResolvedValue({ success: true, data: [] });

      await useFolderStore.getState().loadTree();

      expect(useFolderStore.getState().folders).toEqual([]);
    });

    it('should set error on failure', async () => {
      mockElectron.folders.getTree.mockResolvedValue({ success: false, error: 'DB error' });

      await useFolderStore.getState().loadTree();

      expect(useFolderStore.getState().error).toBe('DB error');
      expect(useFolderStore.getState().isLoading).toBe(false);
    });

    it('should set generic error on non-Error failure', async () => {
      mockElectron.folders.getTree.mockRejectedValue('fail');

      await useFolderStore.getState().loadTree();

      expect(useFolderStore.getState().error).toBe('Failed to load folders');
    });
  });

  describe('createFolder', () => {
    it('should create root folder and insert into state', async () => {
      const newFolder = makeFolder('new-root', 'New Root', null);
      mockElectron.folders.create.mockResolvedValue({ success: true, data: newFolder });

      const result = await useFolderStore.getState().createFolder(null, 'New Root', '🏠');

      expect(result).toEqual(newFolder);
      expect(useFolderStore.getState().folders).toContainEqual(newFolder);
    });

    it('should create child folder and auto-expand parent', async () => {
      const root = makeFolder('root', 'Root', null);
      useFolderStore.setState({ folders: [root] });

      const child = makeFolder('child', 'Child', 'root');
      mockElectron.folders.create.mockResolvedValue({ success: true, data: child });

      await useFolderStore.getState().createFolder('root', 'Child');

      const state = useFolderStore.getState();
      expect(state.folders[0].children).toHaveLength(1);
      expect(state.folders[0].children![0]).toEqual(child);
      expect(state.expandedFolderIds.has('root')).toBe(true);
    });

    it('should return null and set error on failure', async () => {
      mockElectron.folders.create.mockRejectedValue(new Error('DB error'));

      const result = await useFolderStore.getState().createFolder(null, 'Fail');

      expect(result).toBeNull();
      expect(useFolderStore.getState().error).toBe('DB error');
    });

    it('should set generic error on non-Error failure', async () => {
      mockElectron.folders.create.mockRejectedValue('fail');

      await useFolderStore.getState().createFolder(null, 'Fail');

      expect(useFolderStore.getState().error).toBe('Failed to create folder');
    });
  });

  describe('updateFolder', () => {
    it('should update folder name in state', async () => {
      const original = makeFolder('f1', 'Original', null);
      useFolderStore.setState({ folders: [original] });

      mockElectron.folders.update.mockResolvedValue({ success: true, data: { ...original, name: 'Renamed' } });

      await useFolderStore.getState().updateFolder('f1', { name: 'Renamed' });

      expect(useFolderStore.getState().folders[0].name).toBe('Renamed');
    });

    it('should set error on failure', async () => {
      mockElectron.folders.update.mockResolvedValue({ success: false, error: 'DB error' });

      await useFolderStore.getState().updateFolder('f1', { name: 'X' });

      expect(useFolderStore.getState().error).toBe('DB error');
    });
  });

  describe('moveFolder', () => {
    it('should move folder and reload tree', async () => {
      const updatedTree: Folder[] = [makeFolder('root', 'Root', null)];
      mockElectron.folders.move.mockResolvedValue({ success: true, data: updatedTree });
      mockElectron.folders.getTree.mockResolvedValue({ success: true, data: updatedTree });

      await useFolderStore.getState().moveFolder('child', 'root', 0);

      expect(mockElectron.folders.move).toHaveBeenCalledWith('child', 'root', 0);
      expect(useFolderStore.getState().folders).toEqual(updatedTree);
    });

    it('should prevent moving folder into its own descendant', async () => {
      const root = makeFolder('root', 'Root', null, [makeFolder('child', 'Child', 'root')]);
      useFolderStore.setState({ folders: [root] });

      await useFolderStore.getState().moveFolder('root', 'child', 0);

      expect(useFolderStore.getState().error).toBe('Cannot move a folder into its own descendant');
      expect(mockElectron.folders.move).not.toHaveBeenCalled();
    });

    it('should set error on IPC failure', async () => {
      mockElectron.folders.move.mockResolvedValue({ success: false, error: 'DB error' });

      await useFolderStore.getState().moveFolder('f1', null, 0);

      expect(useFolderStore.getState().error).toBe('DB error');
    });
  });

  describe('deleteFolder', () => {
    it('should delete folder from state', async () => {
      const folder = makeFolder('to-delete', 'Delete Me', null);
      useFolderStore.setState({ folders: [folder] });
      mockElectron.folders.delete.mockResolvedValue({ success: true });

      await useFolderStore.getState().deleteFolder('to-delete');

      expect(useFolderStore.getState().folders).toHaveLength(0);
    });

    it('should clear selectedFolderId if deleting the selected folder', async () => {
      const folder = makeFolder('selected', 'Selected', null);
      useFolderStore.setState({
        folders: [folder],
        selectedFolderId: 'selected',
      });
      mockElectron.folders.delete.mockResolvedValue({ success: true });

      await useFolderStore.getState().deleteFolder('selected');

      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });

    it('should remove folder from expanded set', async () => {
      const folder = makeFolder('expanded', 'Expanded', null);
      useFolderStore.setState({
        folders: [folder],
        expandedFolderIds: new Set(['expanded']),
      });
      mockElectron.folders.delete.mockResolvedValue({ success: true });

      await useFolderStore.getState().deleteFolder('expanded');

      expect(useFolderStore.getState().expandedFolderIds.has('expanded')).toBe(false);
    });

    it('should set error on failure', async () => {
      mockElectron.folders.delete.mockRejectedValue(new Error('DB error'));

      await useFolderStore.getState().deleteFolder('f1');

      expect(useFolderStore.getState().error).toBe('DB error');
    });
  });
});
