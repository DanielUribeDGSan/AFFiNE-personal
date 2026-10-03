import { globalStyle, style } from '@vanilla-extract/css';

/**
 * Compact left-aligned page layout (less empty side space than default AFFiNE).
 */
export const editor = style({
  flex: 1,
  width: '100%',
  minWidth: 0,
  vars: {
    '--affine-editor-width': '100%',
    '--affine-editor-side-padding': '20px',
  },
  selectors: {
    '&.full-screen': {
      width: '100%',
      minWidth: 0,
      vars: {
        '--affine-editor-width': '100%',
        '--affine-editor-side-padding': '20px',
      },
    },
  },
  '@media': {
    'screen and (max-width: 800px)': {
      vars: {
        '--affine-editor-width': '100%',
        '--affine-editor-side-padding': '16px',
      },
      selectors: {
        '&.is-public': {
          vars: {
            '--affine-editor-width': '100%',
            '--affine-editor-side-padding': '16px',
          },
        },
      },
    },
  },
});

// Prefer left-aligned content instead of a centered narrow column.
globalStyle(`${editor} .affine-page-root-block-container`, {
  maxWidth: '100%',
  margin: '0',
});

globalStyle(`${editor} .doc-title-container`, {
  maxWidth: '100%',
  margin: '0',
});

// Remove the grey panel behind database tables.
globalStyle(`${editor} affine-database`, {
  backgroundColor: 'transparent',
  background: 'transparent',
});
