import { MenuSeparator } from '@affine/component';
import {
  handleInlineAskAIAction,
  pageAIGroups,
} from '@affine/core/blocksuite/ai';
import { useEnableAI } from '@affine/core/components/hooks/affine/use-enable-ai';
import { DocsService } from '@affine/core/modules/doc';
import { EditorService } from '@affine/core/modules/editor';
import { TemplateDocService } from '@affine/core/modules/template-doc';
import {
  TemplateListMenu,
  TemplateListMenuAdd,
} from '@affine/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@affine/i18n';
import track from '@affine/track';
import { insertEmptyEmbedIframeCommand } from '@blocksuite/affine-block-embed';
import { insertImagesCommand } from '@blocksuite/affine-block-image';
import { updateBlockType } from '@blocksuite/affine/blocks/note';
import { PageRootBlockComponent } from '@blocksuite/affine/blocks/root';
import { toggleLink } from '@blocksuite/affine/inlines/link';
import { getSelectedModelsCommand } from '@blocksuite/affine/shared/commands';
import type { Store } from '@blocksuite/affine/store';
import {
  AiIcon,
  CheckBoxCheckLinearIcon,
  EdgelessIcon,
  EmbedWebIcon,
  Heading1Icon,
  ImageIcon,
  LinkIcon,
  TemplateColoredIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAsyncCallback } from '../../components/hooks/affine-async-hooks';
import * as styles from './starter-bar.css';

const Badge = forwardRef<
  HTMLLIElement,
  HTMLAttributes<HTMLLIElement> & {
    icon: React.ReactNode;
    text: string;
    active?: boolean;
  }
>(function Badge({ icon, text, className, active, ...attrs }, ref) {
  return (
    <li
      data-active={active}
      className={clsx(styles.badge, className)}
      ref={ref}
      {...attrs}
    >
      <span className={styles.badgeText}>{text}</span>
      <span className={styles.badgeIcon}>{icon}</span>
    </li>
  );
});

function focusFirstParagraph(editorService: EditorService) {
  const std = editorService.editor.editorContainer$.value?.std;
  if (!std) return null;

  const rootBlockId = std.host.store.root?.id;
  if (!rootBlockId) return null;

  const rootComponent = std.view.getBlock(rootBlockId);
  if (!(rootComponent instanceof PageRootBlockComponent)) return null;

  return { std, ...rootComponent.focusFirstParagraph() };
}

const StarterBarNotEmpty = ({ doc }: { doc: Store }) => {
  const t = useI18n();

  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const editorService = useService(EditorService);

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );
  const enableAI = useEnableAI();

  const handleSelectTemplate = useAsyncCallback(
    async (templateId: string) => {
      await docsService.duplicateFromTemplate(templateId, doc.id);
      track.doc.editor.starterBar.quickStart({ with: 'template' });
    },
    [doc.id, docsService]
  );

  const startWithEdgeless = useCallback(() => {
    const record = docsService.list.doc$(doc.id).value;
    record?.setPrimaryMode('edgeless');
    editorService.editor.setMode('edgeless');
  }, [doc.id, docsService.list, editorService.editor]);

  const onTemplateMenuOpenChange = useCallback((open: boolean) => {
    if (open) track.doc.editor.starterBar.openTemplateListMenu();
    setTemplateMenuOpen(open);
  }, []);

  const startWithAI = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    const { std, id, created } = focused;
    if (created) {
      const subscription = std.view.viewUpdated.subscribe(v => {
        if (v.id === id) {
          subscription.unsubscribe();
          handleInlineAskAIAction(std.host, pageAIGroups);
        }
      });
    } else {
      handleInlineAskAIAction(std.host, pageAIGroups);
    }
  }, [editorService]);

  const startWithHeading = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    focused.std.command.exec(updateBlockType, {
      flavour: 'affine:paragraph',
      props: { type: 'h1' },
    });
  }, [editorService]);

  const startWithChecklist = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    focused.std.command.exec(updateBlockType, {
      flavour: 'affine:list',
      props: { type: 'todo' },
    });
  }, [editorService]);

  const startWithLink = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    focused.std.command.exec(toggleLink);
  }, [editorService]);

  const startWithImage = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    focused.std.command
      .chain()
      .pipe(getSelectedModelsCommand)
      .pipe(insertImagesCommand, { removeEmptyLine: true })
      .run();
  }, [editorService]);

  const startWithVideo = useCallback(() => {
    const focused = focusFirstParagraph(editorService);
    if (!focused) return;
    focused.std.command
      .chain()
      .pipe(getSelectedModelsCommand)
      .pipe(insertEmptyEmbedIframeCommand, {
        place: 'after',
        removeEmptyLine: true,
      })
      .run();
  }, [editorService]);

  const showTemplate = !isTemplate;

  return (
    <div className={styles.root} data-testid="starter-bar">
      {t['com.affine.page-starter-bar.start']()}
      <ul className={styles.badges}>
        <Badge
          data-testid="start-with-heading-badge"
          icon={<Heading1Icon />}
          text={t['com.affine.page-starter-bar.heading']()}
          onClick={startWithHeading}
        />
        <Badge
          data-testid="start-with-checklist-badge"
          icon={<CheckBoxCheckLinearIcon />}
          text={t['com.affine.page-starter-bar.checklist']()}
          onClick={startWithChecklist}
        />
        <Badge
          data-testid="start-with-image-badge"
          icon={<ImageIcon />}
          text={t['com.affine.page-starter-bar.image']()}
          onClick={startWithImage}
        />
        <Badge
          data-testid="start-with-video-badge"
          icon={<EmbedWebIcon />}
          text={t['com.affine.page-starter-bar.video']()}
          onClick={startWithVideo}
        />
        <Badge
          data-testid="start-with-link-badge"
          icon={<LinkIcon />}
          text={t['com.affine.page-starter-bar.link']()}
          onClick={startWithLink}
        />

        {enableAI ? (
          <Badge
            data-testid="start-with-ai-badge"
            icon={<AiIcon className={styles.aiIcon} />}
            text={t['com.affine.page-starter-bar.ai']()}
            onClick={startWithAI}
          />
        ) : null}

        {showTemplate ? (
          <TemplateListMenu
            onSelect={handleSelectTemplate}
            rootOptions={{
              open: templateMenuOpen,
              onOpenChange: onTemplateMenuOpenChange,
            }}
            suffixItems={
              <>
                <MenuSeparator />
                <TemplateListMenuAdd />
              </>
            }
          >
            <Badge
              data-testid="template-docs-badge"
              icon={<TemplateColoredIcon />}
              text={t['com.affine.page-starter-bar.template']()}
              active={templateMenuOpen}
            />
          </TemplateListMenu>
        ) : null}

        <Badge
          icon={<EdgelessIcon />}
          text={t['com.affine.page-starter-bar.edgeless']()}
          onClick={startWithEdgeless}
        />
      </ul>
    </div>
  );
};

export const StarterBar = ({ doc }: { doc: Store }) => {
  const [isEmpty, setIsEmpty] = useState(doc.isEmpty);
  const templateDocService = useService(TemplateDocService);

  const isTemplate = useLiveData(
    useMemo(
      () => templateDocService.list.isTemplate$(doc.id),
      [doc.id, templateDocService.list]
    )
  );

  useEffect(() => {
    return doc.isEmpty$.subscribe(value => {
      setIsEmpty(value);
    });
  }, [doc]);

  if (!isEmpty || isTemplate) return null;

  return <StarterBarNotEmpty doc={doc} />;
};
