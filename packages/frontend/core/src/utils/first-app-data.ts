// the following import is used to ensure the block suite editor effects are run
import '../blocksuite/block-suite-editor';

import { DebugLogger } from '@affine/debug';
import shiftWorkspaceUrl from '@affine/templates/shift.zip';
import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';

import { DocsService } from '../modules/doc';
import type { FolderNode } from '../modules/organize';
import { OrganizeService } from '../modules/organize';
import {
  getAFFiNEWorkspaceSchema,
  type WorkspacesService,
} from '../modules/workspace';

/** AppFlowy-like sidebar sections for the default Shift workspace. */
const SHIFT_WORKSPACE_NAME = 'Shift';

type SectionSpec = {
  folder: string;
  /** Doc title prefixes to link directly under the folder */
  docs?: string[];
  /** Nested folders (AppFlowy-style hierarchy) */
  children?: Array<{
    folder: string;
    docs: string[];
  }>;
};

/**
 * Sidebar layout inspired by AppFlowy:
 * General → Getting started (+ guides)
 * Tasks / Sprints / Projects → database pages with Board/Table views
 * Shared → public links hub
 */
const SHIFT_SECTIONS: SectionSpec[] = [
  {
    folder: 'General',
    children: [
      {
        folder: 'Getting started',
        docs: [
          'Getting started',
          'Desktop guide',
          'Mobile guide',
          'Web guide',
        ],
      },
    ],
  },
  {
    folder: 'Tasks',
    docs: ['Tasks'],
  },
  {
    folder: 'Sprints',
    docs: ['Sprints'],
  },
  {
    folder: 'Projects',
    docs: ['Projects'],
  },
  {
    folder: 'Shared',
    docs: ['Shared'],
  },
];

function findDocByTitlePrefix(
  docs: Array<{ id: string; title$: { value: string } }>,
  prefix: string
) {
  const normalized = prefix.toLowerCase();
  return docs.find(p =>
    p.title$.value.trim().toLowerCase().startsWith(normalized)
  );
}

function linkDocsToFolder(
  folder: FolderNode,
  docs: Array<{ id: string; title$: { value: string } }>,
  titlePrefixes: string[]
) {
  for (const prefix of titlePrefixes) {
    const doc = findDocByTitlePrefix(docs, prefix);
    if (!doc) continue;
    folder.createLink('doc', doc.id, folder.indexAt('after'));
  }
}

function createShiftOrganizeTree(
  organizeService: OrganizeService,
  docs: Array<{ id: string; title$: { value: string } }>
) {
  const rootFolder = organizeService.folderTree.rootFolder;

  for (const section of SHIFT_SECTIONS) {
    const sectionFolderId = rootFolder.createFolder(
      section.folder,
      rootFolder.indexAt('after')
    );
    const sectionFolder =
      organizeService.folderTree.folderNode$(sectionFolderId).value;
    if (!sectionFolder) continue;

    if (section.docs?.length) {
      linkDocsToFolder(sectionFolder, docs, section.docs);
    }

    for (const child of section.children ?? []) {
      const childFolderId = sectionFolder.createFolder(
        child.folder,
        sectionFolder.indexAt('after')
      );
      const childFolder =
        organizeService.folderTree.folderNode$(childFolderId).value;
      if (!childFolder) continue;
      linkDocsToFolder(childFolder, docs, child.docs);
    }
  }
}

export async function buildShowcaseWorkspace(
  workspacesService: WorkspacesService,
  flavour: string,
  workspaceName: string = SHIFT_WORKSPACE_NAME
) {
  const meta = await workspacesService.create(flavour, async docCollection => {
    docCollection.meta.initialize();
    docCollection.doc.getMap('meta').set('name', workspaceName);
    const blob = await (await fetch(shiftWorkspaceUrl)).blob();

    await ZipTransformer.importDocs(
      docCollection,
      getAFFiNEWorkspaceSchema(),
      blob
    );
  });

  const { workspace, dispose } = workspacesService.open({ metadata: meta });

  await workspace.engine.doc.waitForDocReady(workspace.id);

  const docsService = workspace.scope.get(DocsService);
  const organizeService = workspace.scope.get(OrganizeService);
  const docs = docsService.list.docs$.value;

  createShiftOrganizeTree(organizeService, docs);

  // Land on Getting started (AppFlowy-style home)
  const defaultDoc = findDocByTitlePrefix(docs, 'Getting started');

  dispose();

  return { meta, defaultDocId: defaultDoc?.id };
}

const logger = new DebugLogger('createFirstAppData');

let firstAppDataPromise:
  | Promise<Awaited<ReturnType<typeof buildShowcaseWorkspace>>>
  | undefined;

export function createFirstAppData(workspacesService: WorkspacesService) {
  if (workspacesService.list.workspaces$.value.length > 0) {
    return;
  }

  if (
    !BUILD_CONFIG.isMobileEdition &&
    localStorage.getItem('is-first-open') !== null
  ) {
    return;
  }

  firstAppDataPromise ??= buildShowcaseWorkspace(
    workspacesService,
    'local',
    SHIFT_WORKSPACE_NAME
  ).finally(() => {
    firstAppDataPromise = undefined;
  });

  return firstAppDataPromise.then(({ meta, defaultDocId }) => {
    localStorage.setItem('is-first-open', 'false');
    logger.info('create first workspace', defaultDocId);
    return { meta, defaultPageId: defaultDocId };
  });
}
