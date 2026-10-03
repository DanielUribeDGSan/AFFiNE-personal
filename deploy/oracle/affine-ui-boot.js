/**
 * Safe boot helpers for self-hosted Shift UI.
 * - Auto-create linked doc in database peek
 * - Persistent insert bar (heading/media/link…)
 * - Image: file picker + drag & drop onto the editor
 */
(function () {
  // Bump when boot features change so newer deploys re-init after old scripts.
  var BOOT_VER = 4;
  if (window.__affineUiBootVersion >= BOOT_VER) return;
  window.__affineUiBootVersion = BOOT_VER;
  window.__affineUiBoot = true;

  // Prefer web; never prompt to open/download the desktop app.
  try {
    localStorage.setItem('global-state:open-link-mode', JSON.stringify('open-in-web'));
    localStorage.setItem('open-link-mode', 'open-in-web');
  } catch (e) {}

  var PROMPT = 'Click to create a linked doc in center peek.';
  var PROMPT_SHORT = 'Click to create a linked doc';
  var lastClickAt = 0;
  var lastFocusAt = 0;
  var BAR_ID = 'affine-shift-insert-bar';
  var DROP_BOUND = false;

  function findCreateLink() {
    var nodes = document.querySelectorAll('div');
    var candidates = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = (el.textContent || '').trim();
      if (t !== PROMPT && t !== PROMPT_SHORT) continue;
      var cs = window.getComputedStyle(el);
      candidates.push({
        el: el,
        pointer: cs.cursor === 'pointer' ? 1 : 0,
        children: el.childElementCount,
      });
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      if (b.pointer !== a.pointer) return b.pointer - a.pointer;
      return a.children - b.children;
    });
    return candidates[0].el;
  }

  function clickCreate() {
    var now = Date.now();
    if (now - lastClickAt < 2500) return false;
    var el = findCreateLink();
    if (!el) return false;
    lastClickAt = now;
    try {
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
      el.click();
    } catch (e) {}
    setTimeout(focusEditor, 800);
    setTimeout(focusEditor, 1800);
    return true;
  }

  function activeHost() {
    return (
      document.querySelector('affine-data-view-record-detail editor-host') ||
      document.querySelector('.affine-page-viewport editor-host') ||
      document.querySelector('editor-host')
    );
  }

  function focusEditor() {
    var now = Date.now();
    if (now - lastFocusAt < 800) return null;
    var ae = document.activeElement;
    if (
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        (ae.isContentEditable && (ae.textContent || '').trim().length > 0))
    ) {
      return ae;
    }
    var host = activeHost();
    if (!host) return null;
    var para =
      host.querySelector(
        'affine-paragraph .affine-paragraph-rich-text-wrapper'
      ) ||
      host.querySelector('affine-paragraph') ||
      host.querySelector('[contenteditable="true"]');
    if (!para) return null;
    lastFocusAt = now;
    try {
      para.click();
      var rich = para.querySelector('[contenteditable="true"]') || para;
      if (rich && rich.focus) rich.focus();
      return rich;
    } catch (e) {
      return null;
    }
  }

  function getNoteAndTarget() {
    var host = activeHost();
    if (!host || !host.std) return null;
    var store = host.std.store;
    var root = store.root;
    if (!root) return null;
    var note = null;
    for (var i = 0; i < root.children.length; i++) {
      if (root.children[i].flavour === 'affine:note') {
        note = root.children[i];
        break;
      }
    }
    if (!note) return null;
    var target =
      note.children[note.children.length - 1] || note;
    return { host: host, std: host.std, store: store, note: note, target: target };
  }

  function readImageSize(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = function () {
        resolve({ width: 800, height: 600 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function insertImageFiles(fileList) {
    var ctx = getNoteAndTarget();
    if (!ctx) return Promise.resolve(false);
    var files = [];
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].type && fileList[i].type.indexOf('image/') === 0) {
        files.push(fileList[i]);
      }
    }
    if (!files.length) return Promise.resolve(false);

    focusEditor();
    var store = ctx.store;
    var target = ctx.target;

    return files
      .reduce(function (chain, file) {
        return chain.then(function () {
          return Promise.all([
            store.blobSync.set(file),
            readImageSize(file),
          ]).then(function (pair) {
            var sourceId = pair[0];
            var size = pair[1];
            var props = {
              flavour: 'affine:image',
              sourceId: sourceId,
              width: size.width,
              height: size.height,
              size: file.size,
            };
            if (typeof store.addSiblingBlocks === 'function' && target) {
              var ids = store.addSiblingBlocks(target, [props], 'after');
              if (ids && ids[0]) {
                var next = store.getBlock(ids[0]);
                if (next && next.model) target = next.model;
              }
            } else {
              store.addBlock(
                'affine:image',
                {
                  sourceId: sourceId,
                  width: size.width,
                  height: size.height,
                  size: file.size,
                },
                ctx.note.id
              );
            }
          });
        });
      }, Promise.resolve())
      .then(function () {
        return true;
      })
      .catch(function (err) {
        console.warn('[shift-ui] insertImageFiles failed', err);
        return false;
      });
  }

  function openImagePicker() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      if (input.files && input.files.length) {
        insertImageFiles(input.files).finally(function () {
          input.remove();
        });
      } else {
        input.remove();
      }
    });
    input.click();
  }

  function bindImageDrop() {
    if (DROP_BOUND) return;
    DROP_BOUND = true;

    function onDragOver(ev) {
      var dt = ev.dataTransfer;
      if (!dt) return;
      var types = dt.types ? [].slice.call(dt.types) : [];
      var hasFiles =
        types.indexOf('Files') !== -1 || types.indexOf('files') !== -1;
      if (!hasFiles) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        dt.dropEffect = 'copy';
      } catch (e) {}
      document.documentElement.classList.add('shift-image-drop-active');
    }

    function onDragLeave(ev) {
      if (ev.relatedTarget && document.documentElement.contains(ev.relatedTarget))
        return;
      document.documentElement.classList.remove('shift-image-drop-active');
    }

    function onDrop(ev) {
      document.documentElement.classList.remove('shift-image-drop-active');
      var dt = ev.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      var hasImage = false;
      for (var i = 0; i < dt.files.length; i++) {
        if (dt.files[i].type && dt.files[i].type.indexOf('image/') === 0) {
          hasImage = true;
          break;
        }
      }
      if (!hasImage) return;
      ev.preventDefault();
      ev.stopPropagation();
      insertImageFiles(dt.files);
    }

    // Capture on document so Finder drops aren't swallowed by overlays
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('dragleave', onDragLeave, true);
    document.addEventListener('drop', onDrop, true);
  }

  function insertSlashAndPick(labelMatchers) {
    var rich = focusEditor();
    if (!rich) return;
    try {
      rich.focus();
      document.execCommand('insertText', false, '/');
    } catch (e) {
      try {
        rich.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: '/',
          })
        );
      } catch (e2) {}
    }

    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var items = document.querySelectorAll(
        '[role="option"], [role="menuitem"], button, div'
      );
      for (var i = 0; i < items.length; i++) {
        var txt = (items[i].textContent || '').trim().toLowerCase();
        if (!txt || txt.length > 48) continue;
        for (var j = 0; j < labelMatchers.length; j++) {
          if (txt.indexOf(labelMatchers[j]) !== -1) {
            items[i].click();
            clearInterval(timer);
            return;
          }
        }
      }
      if (tries > 20) clearInterval(timer);
    }, 100);
  }

  function findStarterAnchor() {
    var all = document.querySelectorAll('div,ul,section');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (
        t.indexOf('With AI') !== -1 &&
        t.indexOf('Template') !== -1 &&
        t.indexOf('Edgeless') !== -1 &&
        t.length < 80
      ) {
        return el;
      }
    }
    var paras = document.querySelectorAll('affine-paragraph');
    for (var p = 0; p < paras.length; p++) {
      var pt = (paras[p].textContent || '').trim();
      if (!pt || pt.indexOf("Type '/'") !== -1) return paras[p];
    }
    return null;
  }

  function ensureBar() {
    var existing = document.getElementById(BAR_ID);
    var bodyText = (document.body && document.body.innerText) || '';
    var inDetailEditor =
      !!document.querySelector('affine-data-view-record-detail') ||
      bodyText.indexOf("Type '/' for commands") !== -1 ||
      (bodyText.indexOf('With AI') !== -1 &&
        bodyText.indexOf('Edgeless') !== -1 &&
        !!document.querySelector('.doc-title-container'));

    if (!inDetailEditor) {
      if (existing) existing.remove();
      return;
    }

    var anchor = findStarterAnchor();
    if (!anchor) {
      if (existing) existing.style.display = 'none';
      return;
    }

    if (!existing) {
      existing = document.createElement('div');
      existing.id = BAR_ID;
      existing.innerHTML =
        '<div class="shift-bar-inner">' +
        '<button type="button" data-act="heading" title="Heading">T</button>' +
        '<button type="button" data-act="bold" title="Bold"><b>B</b></button>' +
        '<button type="button" data-act="italic" title="Italic"><i>I</i></button>' +
        '<button type="button" data-act="link" title="Link">Link</button>' +
        '<span class="shift-bar-sep"></span>' +
        '<button type="button" data-act="checklist">Checklist</button>' +
        '<button type="button" data-act="image">Imagen</button>' +
        '<button type="button" data-act="video">Video</button>' +
        '<button type="button" data-act="code">Código</button>' +
        '</div>';
      existing.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
      });
      existing.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button[data-act]');
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        var act = btn.getAttribute('data-act');
        if (act === 'bold') {
          focusEditor();
          document.execCommand('bold');
          return;
        }
        if (act === 'italic') {
          focusEditor();
          document.execCommand('italic');
          return;
        }
        if (act === 'image') {
          openImagePicker();
          return;
        }
        if (act === 'heading')
          insertSlashAndPick(['heading 1', 'heading', 'título', 'title', 'h1']);
        else if (act === 'checklist')
          insertSlashAndPick([
            'to-do',
            'todo',
            'checklist',
            'lista de tareas',
            'task',
          ]);
        else if (act === 'video')
          insertSlashAndPick([
            'embed',
            'iframe',
            'video',
            'youtube',
            'loom',
          ]);
        else if (act === 'link')
          insertSlashAndPick(['link', 'enlace', 'bookmark', 'url']);
        else if (act === 'code')
          insertSlashAndPick([
            'code block',
            'code',
            'código',
            'bloque de código',
          ]);
      });
    }

    if (
      existing.parentElement !== anchor.parentElement ||
      existing.nextSibling !== anchor
    ) {
      anchor.parentElement.insertBefore(existing, anchor);
    }
    existing.style.display = 'flex';
  }

  bindImageDrop();

  // "Copy link" in peek/header copies /workspace/... which requires login.
  // Rewrite to /share/... so guests get public read (comments still need session).
  function toPublicShareUrl(text) {
    if (typeof text !== 'string') return null;
    var m = text.match(
      /^(https?:\/\/[^/\s]+)\/workspace\/([0-9a-fA-F-]{36})\/([A-Za-z0-9_-]+)(\?[^#\s]*)?(#.*)?$/
    );
    if (!m) return null;
    return m[1] + '/share/' + m[2] + '/' + m[3] + (m[4] || '') + (m[5] || '');
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var wt = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function (text) {
        var share = toPublicShareUrl(text);
        return wt(share || text);
      };
    }
  } catch (e) {}

  try {
    var oc = document.execCommand;
    if (typeof oc === 'function') {
      document.execCommand = function (cmd) {
        if (String(cmd).toLowerCase() === 'copy') {
          try {
            var sel = String(window.getSelection() || '');
            var share = toPublicShareUrl(sel);
            if (share && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(share);
              return true;
            }
          } catch (e) {}
        }
        return oc.apply(document, arguments);
      };
    }
  } catch (e) {}

  // Light / dark toggle (share page + document views)
  var THEME_KEY = 'theme';
  var THEME_BTN_ID = 'affine-shift-theme-toggle';

  function currentTheme() {
    var fromAttr = document.documentElement.getAttribute('data-theme');
    if (fromAttr === 'light' || fromAttr === 'dark') return fromAttr;
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function syncEditorThemes(next) {
    // page-editor binds data-theme from AppTheme (next-themes), which our
    // toggle does not update. Force editor shells so body text is not gray.
    var nodes = document.querySelectorAll(
      '.page-editor-container, .affine-edgeless-viewport, page-editor > div[data-theme], edgeless-editor > div[data-theme]'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-theme') !== next) {
        nodes[i].setAttribute('data-theme', next);
      }
    }
  }

  function applyTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    window.__affineShiftTheme = next;
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    syncEditorThemes(next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#fafafa' : '#1e1e1e');
    var btn = document.getElementById(THEME_BTN_ID);
    if (btn) {
      btn.setAttribute('aria-label', next === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
      btn.innerHTML =
        next === 'light'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg><span>Oscuro</span>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>Claro</span>';
    }
  }

  function ensureThemeToggle() {
    var btn = document.getElementById(THEME_BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = THEME_BTN_ID;
      btn.type = 'button';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
      });
      document.body.appendChild(btn);
    }
    applyTheme(currentTheme());
  }

  // Keep our choice if the app resets data-theme after hydration / lit re-render
  try {
    var themeObs = new MutationObserver(function () {
      var wanted = window.__affineShiftTheme;
      if (wanted !== 'light' && wanted !== 'dark') {
        try {
          wanted = localStorage.getItem(THEME_KEY);
        } catch (e) {}
      }
      if (wanted !== 'light' && wanted !== 'dark') return;
      if (document.documentElement.getAttribute('data-theme') !== wanted) {
        document.documentElement.setAttribute('data-theme', wanted);
        document.documentElement.style.colorScheme = wanted;
      }
      syncEditorThemes(wanted);
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    themeObs.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  } catch (e) {}

  var MARKETING_TEXT =
    /^(download app|descargar aplicaci[oó]n|built with|construido con|hecho con)$/i;
  var OPEN_APP_TEXT =
    /open this doc in affine app|abrir (este )?doc(umento)? en (la )?app|open in app|abrir en la app/i;

  function hideEl(el) {
    if (!el || el.__affineShiftHidden) return;
    el.__affineShiftHidden = true;
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('hidden', '');
  }

  function stripAffineMarketing() {
    // Banner: "Open this doc in AFFiNE app"
    var card = document.querySelector('[data-testid="open-in-app-card"]');
    if (card) {
      hideEl(card);
      try {
        var dismiss = card.querySelector('button');
        // click close/dismiss if visible so state persists
        var buttons = card.querySelectorAll('button');
        for (var bi = 0; bi < buttons.length; bi++) {
          var bt = (buttons[bi].textContent || '').trim().toLowerCase();
          if (bt === 'dismiss' || bt === 'cerrar' || bt === 'omitir') {
            buttons[bi].click();
            break;
          }
        }
      } catch (e) {}
    }

    // Sidebar "Download App" + share "Built with"
    var clickables = document.querySelectorAll('button, a');
    for (var i = 0; i < clickables.length; i++) {
      var el = clickables[i];
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (MARKETING_TEXT.test(t) || OPEN_APP_TEXT.test(t)) {
        hideEl(el);
        continue;
      }
      var href = el.getAttribute && el.getAttribute('href');
      if (
        href &&
        (href.indexOf('affine.pro/download') !== -1 ||
          href === 'https://affine.pro' ||
          href === 'https://affine.pro/')
      ) {
        // Only hide chrome links, not links typed inside the doc editor
        if (!el.closest('affine-bookmark, affine-embed-linked-doc-block, editor-host rich-text')) {
          hideEl(el);
        }
      }
    }
  }

  setInterval(function () {
    clickCreate();
    ensureBar();
    ensureThemeToggle();
    stripAffineMarketing();
  }, 900);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(clickCreate, 500);
      setTimeout(ensureBar, 700);
      setTimeout(ensureThemeToggle, 200);
      setTimeout(stripAffineMarketing, 100);
    });
  } else {
    setTimeout(clickCreate, 500);
    setTimeout(ensureBar, 700);
    setTimeout(ensureThemeToggle, 200);
    setTimeout(stripAffineMarketing, 100);
  }
})();
