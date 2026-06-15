import { create } from 'zustand';
import { produce, enableMapSet } from 'immer';
import type { Folder } from '../../shared/types';

enableMapSet();

export interface FolderState {
  folders: Folder[];
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  isLoading: boolean;
  error: string | null;

  loadTree: () => Promise<void>;
  createFolder: (parentId: string | null, name: string, emoji?: string) => Promise<Folder | null>;
  updateFolder: (
    id: string,
    fields: { name?: string; emoji?: string; coverImage?: string },
  ) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null, sortOrder?: number) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  expandFolder: (id: string) => void;
  collapseFolder: (id: string) => void;
  toggleExpandFolder: (id: string) => void;
  reset: () => void;
}

function findAndUpdateNode(
  nodes: Folder[],
  id: string,
  updater: (folder: Folder) => void,
): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      updater(nodes[i]);
      return true;
    }
    if (nodes[i].children && findAndUpdateNode(nodes[i].children!, id, updater)) {
      return true;
    }
  }
  return false;
}

function removeNode(nodes: Folder[], id: string): Folder[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children ? { ...n, children: removeNode(n.children, id) } : n));
}

function containsNode(nodes: Folder[], id: string): boolean {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (node.children && containsNode(node.children, id)) return true;
  }
  return false;
}

function isDescendant(nodes: Folder[], ancestorId: string, descendantId: string): boolean {
  for (const node of nodes) {
    if (node.id === ancestorId) {
      return node.children ? containsNode(node.children, descendantId) : false;
    }
    if (node.children && isDescendant(node.children, ancestorId, descendantId)) {
      return true;
    }
  }
  return false;
}

function insertNode(nodes: Folder[], parentId: string | null, folder: Folder): Folder[] {
  if (parentId === null) {
    return [...nodes, folder];
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...(n.children || []), folder] };
    }
    if (n.children) {
      return { ...n, children: insertNode(n.children, parentId, folder) };
    }
    return n;
  });
}

export const useFolderStore = create<FolderState>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  expandedFolderIds: new Set<string>(),
  isLoading: false,
  error: null,

  loadTree: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.electron.folders.getTree();
      if (!result.success) throw new Error(result.error || 'Failed to load folders');
      set({ folders: result.data, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load folders';
      set({ isLoading: false, error: message });
    }
  },

  createFolder: async (parentId, name, emoji) => {
    set({ error: null });
    try {
      const result = await window.electron.folders.create(parentId, name, emoji);
      if (!result.success) throw new Error(result.error || 'Failed to create folder');
      const folder = result.data;
      set(
        produce((state: FolderState) => {
          state.folders = insertNode(state.folders, parentId, folder);
          if (parentId) {
            state.expandedFolderIds.add(parentId);
          }
        }),
      );
      return folder;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create folder';
      set({ error: message });
      return null;
    }
  },

  updateFolder: async (id, fields) => {
    set({ error: null });
    try {
      const result = await window.electron.folders.update(id, fields);
      if (!result.success) throw new Error(result.error || 'Failed to update folder');
      const updated = result.data;
      if (updated) {
        set(
          produce((state: FolderState) => {
            findAndUpdateNode(state.folders, id, (folder) => {
              Object.assign(folder, updated);
            });
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update folder';
      set({ error: message });
    }
  },

  moveFolder: async (id, newParentId, sortOrder = 0) => {
    if (newParentId && isDescendant(get().folders, id, newParentId)) {
      set({ error: 'Cannot move a folder into its own descendant' });
      return;
    }
    set({ error: null });
    try {
      const moveResult = await window.electron.folders.move(id, newParentId, sortOrder);
      if (!moveResult.success) throw new Error(moveResult.error || 'Failed to move folder');
      const treeResult = await window.electron.folders.getTree();
      if (!treeResult.success) throw new Error(treeResult.error || 'Failed to reload tree');
      set({ folders: treeResult.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to move folder';
      set({ error: message });
    }
  },

  deleteFolder: async (id) => {
    set({ error: null });
    try {
      await window.electron.folders.delete(id);
      set(
        produce((state: FolderState) => {
          state.folders = removeNode(state.folders, id);
          if (state.selectedFolderId === id) {
            state.selectedFolderId = null;
          }
          state.expandedFolderIds.delete(id);
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete folder';
      set({ error: message });
    }
  },

  setSelectedFolder: (id) => set({ selectedFolderId: id }),

  expandFolder: (id) =>
    set(
      produce((state: FolderState) => {
        state.expandedFolderIds.add(id);
      }),
    ),

  collapseFolder: (id) =>
    set(
      produce((state: FolderState) => {
        state.expandedFolderIds.delete(id);
      }),
    ),

  toggleExpandFolder: (id) =>
    set(
      produce((state: FolderState) => {
        if (state.expandedFolderIds.has(id)) {
          state.expandedFolderIds.delete(id);
        } else {
          state.expandedFolderIds.add(id);
        }
      }),
    ),

  reset: () =>
    set({
      folders: [],
      selectedFolderId: null,
      expandedFolderIds: new Set<string>(),
      isLoading: false,
      error: null,
    }),
}));
