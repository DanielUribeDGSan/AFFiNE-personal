/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const importDocs = vi.fn();
const docsServiceToken = Symbol('DocsService');
const organizeServiceToken = Symbol('OrganizeService');

vi.mock('../../blocksuite/block-suite-editor', () => ({}));
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  ZipTransformer: {
    importDocs,
  },
}));
vi.mock('@affine/templates/shift.zip', () => ({
  default: '/shift.zip',
}));
vi.mock('../../modules/doc', () => ({
  DocsService: docsServiceToken,
}));
vi.mock('../../modules/organize', () => ({
  OrganizeService: organizeServiceToken,
}));
vi.mock('../../modules/workspace', () => ({
  getAFFiNEWorkspaceSchema: () => 'schema',
}));

const originalBuildConfig = globalThis.BUILD_CONFIG;

function createFolderNodeMock() {
  const children: Array<{ id: string; name: string }> = [];
  const node = {
    id: null as string | null,
    createFolder: vi.fn((name: string) => {
      const id = `folder-${children.length + 1}-${name}`;
      children.push({ id, name });
      return id;
    }),
    createLink: vi.fn(),
    indexAt: vi.fn(() => 'a0'),
  };
  return { node, children };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  importDocs.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob()))
  );
  vi.stubGlobal('BUILD_CONFIG', {
    ...originalBuildConfig,
    isMobileEdition: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createWorkspacesService({
  existing = [],
  createWorkspace,
}: {
  existing?: Array<{ id: string; flavour: string }>;
  createWorkspace?: (
    flavour: string
  ) => Promise<{ id: string; flavour: string }>;
} = {}) {
  const workspaces = [...existing];
  const createMock = vi.fn(
    createWorkspace ??
      (async (flavour: string) => {
        const meta = { id: `workspace-${workspaces.length + 1}`, flavour };
        workspaces.push(meta);
        return meta;
      })
  );
  const waitForDocReady = vi.fn(async () => {});
  const root = createFolderNodeMock();
  const folderNodes = new Map<string, ReturnType<typeof createFolderNodeMock>['node']>();

  const create = vi.fn(
    async (
      flavour: string,
      setup: (docCollection: {
        meta: { initialize: () => void };
        doc: { getMap: () => { set: (key: string, value: string) => void } };
      }) => Promise<void>
    ) => {
      const meta = await createMock(flavour);
      await setup({
        meta: { initialize: vi.fn() },
        doc: {
          getMap: () => ({
            set: vi.fn(),
          }),
        },
      });
      return meta;
    }
  );
  const service = {
    list: {
      ['workspaces$']: {
        get value() {
          return workspaces;
        },
      },
    },
    create,
    open: ({ metadata }: { metadata: { id: string } }) => ({
      workspace: {
        id: metadata.id,
        engine: {
          doc: {
            waitForDocReady,
          },
        },
        scope: {
          get: (token: symbol) => {
            if (token === docsServiceToken) {
              return {
                list: {
                  ['docs$']: {
                    value: [
                      {
                        id: 'getting-started',
                        ['title$']: { value: 'Getting started' },
                      },
                      {
                        id: 'desktop-guide',
                        ['title$']: { value: 'Desktop guide' },
                      },
                      {
                        id: 'mobile-guide',
                        ['title$']: { value: 'Mobile guide' },
                      },
                      {
                        id: 'web-guide',
                        ['title$']: { value: 'Web guide' },
                      },
                      {
                        id: 'tasks',
                        ['title$']: { value: 'Tasks' },
                      },
                      {
                        id: 'sprints',
                        ['title$']: { value: 'Sprints' },
                      },
                      {
                        id: 'projects',
                        ['title$']: { value: 'Projects' },
                      },
                      {
                        id: 'shared',
                        ['title$']: { value: 'Shared' },
                      },
                    ],
                  },
                },
              };
            }
            if (token === organizeServiceToken) {
              return {
                folderTree: {
                  rootFolder: {
                    ...root.node,
                    createFolder: (name: string, index: string) => {
                      const id = root.node.createFolder(name, index);
                      const child = createFolderNodeMock().node;
                      child.id = id;
                      folderNodes.set(id, child);
                      return id;
                    },
                  },
                  folderNode$: (id: string) => ({
                    get value() {
                      const existing = folderNodes.get(id);
                      if (!existing) return null;
                      // Nested createFolder also registers nodes
                      const wrapped = {
                        ...existing,
                        createFolder: (name: string, index: string) => {
                          const childId = existing.createFolder(name, index);
                          const child = createFolderNodeMock().node;
                          child.id = childId;
                          folderNodes.set(childId, child);
                          return childId;
                        },
                      };
                      return wrapped;
                    },
                  }),
                },
              };
            }
            throw new Error('Unexpected service token');
          },
        },
      },
      dispose: vi.fn(),
    }),
  };

  return {
    service,
    createMock,
    workspaces,
    root,
    folderNodes,
  };
}

describe('createFirstAppData', () => {
  test('does not create on desktop when the first-open marker exists', async () => {
    localStorage.setItem('is-first-open', 'false');
    const { createFirstAppData } = await import('../first-app-data');
    const { service, createMock } = createWorkspacesService();

    expect(createFirstAppData(service as never)).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('creates on mobile when the first-open marker is stale and no workspace exists', async () => {
    vi.stubGlobal('BUILD_CONFIG', {
      ...originalBuildConfig,
      isMobileEdition: true,
    });
    localStorage.setItem('is-first-open', 'false');
    const { createFirstAppData } = await import('../first-app-data');
    const { service, createMock, root } = createWorkspacesService();

    await expect(createFirstAppData(service as never)).resolves.toMatchObject({
      meta: { id: 'workspace-1', flavour: 'local' },
      defaultPageId: 'getting-started',
    });
    expect(createMock).toHaveBeenCalledOnce();
    expect(localStorage.getItem('is-first-open')).toBe('false');
    // AppFlowy sections: General, Tasks, Sprints, Projects, Shared
    expect(root.node.createFolder).toHaveBeenCalled();
    const folderNames = root.node.createFolder.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(folderNames).toEqual(
      expect.arrayContaining([
        'General',
        'Tasks',
        'Sprints',
        'Projects',
        'Shared',
      ])
    );
  });

  test('does not create when any workspace already exists', async () => {
    vi.stubGlobal('BUILD_CONFIG', {
      ...originalBuildConfig,
      isMobileEdition: true,
    });
    const { createFirstAppData } = await import('../first-app-data');
    const { service, createMock } = createWorkspacesService({
      existing: [{ id: 'existing-workspace', flavour: 'local' }],
    });

    expect(createFirstAppData(service as never)).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('coalesces concurrent creation attempts', async () => {
    vi.stubGlobal('BUILD_CONFIG', {
      ...originalBuildConfig,
      isMobileEdition: true,
    });
    const { createFirstAppData } = await import('../first-app-data');
    let resolveCreate:
      | ((meta: { id: string; flavour: string }) => void)
      | undefined;
    const { service, createMock, workspaces } = createWorkspacesService({
      createWorkspace: flavour =>
        new Promise(resolve => {
          resolveCreate = meta => {
            workspaces.push(meta);
            resolve(meta);
          };
          expect(flavour).toBe('local');
        }),
    });

    const first = createFirstAppData(service as never);
    const second = createFirstAppData(service as never);
    resolveCreate?.({ id: 'workspace-1', flavour: 'local' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        meta: { id: 'workspace-1', flavour: 'local' },
        defaultPageId: 'getting-started',
      },
      {
        meta: { id: 'workspace-1', flavour: 'local' },
        defaultPageId: 'getting-started',
      },
    ]);
    expect(createMock).toHaveBeenCalledOnce();
  });

  test('does not persist the first-open marker when creation fails', async () => {
    vi.stubGlobal('BUILD_CONFIG', {
      ...originalBuildConfig,
      isMobileEdition: true,
    });
    const { createFirstAppData } = await import('../first-app-data');
    const error = new Error('create failed');
    const { service, createMock } = createWorkspacesService({
      createWorkspace: async () => {
        throw error;
      },
    });

    await expect(createFirstAppData(service as never)).rejects.toThrow(error);
    await expect(createFirstAppData(service as never)).rejects.toThrow(error);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('is-first-open')).toBeNull();
  });
});
