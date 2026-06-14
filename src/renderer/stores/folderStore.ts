import { create } from 'zustand';
import { produce } from 'immer';
import type { Folder } from '../../shared/types';

export interface FolderState {
  folders: Folder[];
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  isLoading: boolean;
  error: string | null;

  loadTree: () => Promise<void>;
  createFolder: (parentId: string | null, name: string, emoji?: string) => Promise<Folder | null>;
  updateFolder: (id: string, fields: { name?: string; emoji?: string; coverImage?: string }) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null, sortOrder?: number) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  expandFolder: (id: string) => void;
  collapseFolder: (id: string) => void;
  toggleExpandFolder: (id: string) => void;
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
    .map((n) =>
      n.children ? { ...n, children: removeNode(n.children, id) } : n,
    );
}

function findParentId(nodes: Folder[], id: string, parentId: string | null = null): string | null {
  for (const node of nodes) {
    if (node.id === id) return parentId;
    if (node.children) {
      const found = findParentId(node.children, id, node.id);
      if (found !== null) return found;
    }
  }
  return null;
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

function insertNode(
  nodes: Folder[],
  parentId: string | null,
  folder: Folder,
): Folder[] {
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
      const tree = await window.electron.folders.getTree();
      set({ folders: tree, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load folders';
      set({ isLoading: false, error: message });
    }
  },

  createFolder: async (parentId, name, emoji) => {
    set({ error: null });
    try {
      const folder = await window.electron.folders.create(parentId, name, emoji);
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
      const updated = await window.electron.folders.update(id, fields);
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
      await window.electron.folders.move(id, newParentId, sortOrder);
      const tree = await window.electron.folders.getTree();
      set({ folders: tree });
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
}));
