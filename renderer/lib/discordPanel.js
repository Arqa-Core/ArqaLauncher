// ArqaLauncher -- Discord Panel UI
// Embeds https://discord.com/app in an Electron webview.
//
// Features:
//  * CSS injection: rethemes Discord to match Arqa's dark-purple aesthetic
//  * Preloads while Discord menu item is highlighted; instant entry
//  * Virtual mouse cursor via left gamepad stick (Steam Deck style)
//      A = left-click   X = right-click   B = back/exit   Y = open VK
//      LT / RT = scroll up / down   Start = exit
//  * Text input: A on a text field -> opens existing VirtualKeyboard -> injects text
//
// Loaded via index.html BEFORE renderer.js. Exposes: window.DiscordPanel

/* global React */
/* eslint-disable no-unused-vars */

(() => {
  'use strict';

  const { useState, useEffect, useRef, useCallback } = React;

  // ── Theme CSS injected into the webview ─────────────────────────────────────
  const DISCORD_THEME_CSS = `
    :root, .theme-dark, .theme-light {
      --background-primary:           #1a1525 !important;
      --background-secondary:         #120e24 !important;
      --background-secondary-alt:     #0d0b1a !important;
      --background-tertiary:          #08060f !important;
      --background-floating:          #0d0917 !important;
      --background-nested-floating:   #1a1525 !important;
      --background-mobile-primary:    #1a1525 !important;
      --background-mobile-secondary:  #120e24 !important;
      --background-modifier-hover:    rgba(88,101,242,0.07) !important;
      --background-modifier-active:   rgba(88,101,242,0.14) !important;
      --background-modifier-selected: rgba(88,101,242,0.18) !important;
      --background-modifier-accent:   rgba(88,101,242,0.24) !important;
      --channeltextarea-background:   #0d0b1a !important;
      --modal-background:             #1a1525 !important;
      --modal-footer-background:      #120e24 !important;
      --deprecated-card-bg:           rgba(18,14,36,0.5) !important;
      --deprecated-panel-bg:          #120e24 !important;
      --scrollbar-auto-track:         #08060f !important;
      --scrollbar-auto-thumb:         rgba(88,101,242,0.4) !important;
      --scrollbar-thin-track:         transparent !important;
      --scrollbar-thin-thumb:         rgba(88,101,242,0.35) !important;
    }
    * { scrollbar-color: rgba(88,101,242,0.4) transparent; }
    .arqa-controller-mode * { cursor: none !important; }
  `.trim();

  // ── Rich Presence settings overlay ─────────────────────────────────────────
  function RichPresenceSettings({ onClose }) {
    const [presenceId, setPresenceId] = useState('');
    const [saveMsg,    setSaveMsg]    = useState('');

    useEffect(() => {
      window.arqaAPI?.discord?.getAppConfig?.().then(cfg => {
        if (cfg?.presenceClientId) setPresenceId(cfg.presenceClientId);
      }).catch(() => {});
    }, []);

    const save = useCallback(() => {
      window.arqaAPI?.discord?.saveCredentials({
        clientId: '', clientSecret: '', presenceClientId: presenceId,
      });
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
    }, [presenceId]);

    return h('div', { className: 'dc-rp-overlay' },
      h('div', { className: 'dc-rp-panel' },
        h('h3', { className: 'dc-rp-title' }, 'Rich Presence'),
        h('p', { className: 'dc-rp-desc' },
          'Create a Discord application at ',
          h('strong', null, 'discord.com/developers/applications'),
          ' and paste its Client ID here to show your current game as Discord Rich Presence.'
        ),
        h('label', { className: 'dc-rp-label' }, 'Application Client ID'),
        h('input', {
          className:   'dc-rp-input',
          value:       presenceId,
          onInput:     e => setPresenceId(e.target.value),
          placeholder: 'e.g. 1234567890',
          maxLength:   20,
          spellCheck:  false,
        }),
        h('div', { className: 'dc-rp-actions' },
          h('button', { className: 'dc-rp-save',  onClick: save    }, saveMsg || 'Save'),
          h('button', { className: 'dc-rp-close', onClick: onClose }, 'Close'),
        ),
      )
    );
  }

  // ── Main Discord panel ──────────────────────────────────────────────────────
  function DiscordPanel({ visible }) {
    const [showSettings, setShowSettings] = useState(false);
    const [showCursor,   setShowCursor]   = useState(false);
    const [cursorPos,    setCursorPos]    = useState({ x: 640, y: 360 });

    const webviewRef      = useRef(null);
    const cursorRef       = useRef({ x: 640, y: 360 });
    const prevBtns        = useRef({});
    const rafRef          = useRef(null);
    const vkOpenRef       = useRef(false);
    const showSettingsRef = useRef(false);
    const showCursorRef   = useRef(false);
    const wvReadyRef      = useRef(false); // true after webview dom-ready

    // Keep showSettingsRef in sync with state so gamepad poll closure sees it
    useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);

    // Tell renderer.js to skip its gamepad polling while Discord is active
    useEffect(() => {
      window.__arqaDiscordActive = visible;
      if (!visible) { showCursorRef.current = false; setShowCursor(false); }
      return () => { window.__arqaDiscordActive = false; };
    }, [visible]);

    // Track webview readiness + inject theme CSS + auto-login from cached token
    useEffect(() => {
      const wv = webviewRef.current;
      if (!wv) return;
      const onReady  = () => { wvReadyRef.current = true; };
      const inject   = () => wv.insertCSS?.(DISCORD_THEME_CSS).catch?.(() => {});

      // After each page load: either restore session or cache the live token.
      const onLoad = async () => {
        inject();
        const url = wv.getURL?.() ?? '';
        if (!url.includes('discord.com')) return;

        if (url.includes('/login') || url.includes('/register')) {
          // Session expired → try to restore from local cache
          try {
            const cached = await window.arqaAPI?.discord?.loadWebToken?.();
            if (cached) {
              // Inject token into localStorage then navigate to app
              await wv.executeJavaScript(`
                (function(t){
                  try { localStorage.setItem('token', t); } catch(_){}
                  window.location.replace('/channels/@me');
                })(${JSON.stringify(cached)})
              `);
            }
          } catch (_) {}
        } else {
          // Logged-in page → extract and persist the token locally
          try {
            const token = await wv.executeJavaScript(`localStorage.getItem('token')`);
            if (token && typeof token === 'string' && token.length > 20) {
              window.arqaAPI?.discord?.saveWebToken?.(token);
            }
          } catch (_) {}
        }
      };

      wv.addEventListener('dom-ready',            onReady);
      wv.addEventListener('did-finish-load',      onLoad);
      wv.addEventListener('did-navigate-in-page', inject);
      return () => {
        wv.removeEventListener('dom-ready',            onReady);
        wv.removeEventListener('did-finish-load',      onLoad);
        wv.removeEventListener('did-navigate-in-page', inject);
      };
    }, []);

    // Escape key -> exit Discord (captured before webview swallows it via capture:true)
    useEffect(() => {
      if (!visible) return;
      const handler = e => {
        if (e.key === 'Escape' && !showSettingsRef.current && !window.__arqaVKOpen) {
          window.__arqaNav?.goHome();
        }
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [visible]);

    // Hide virtual cursor when real mouse moves
    useEffect(() => {
      const onMouse = () => {
        if (showCursorRef.current) { showCursorRef.current = false; setShowCursor(false); }
      };
      window.addEventListener('mousemove', onMouse, { passive: true });
      return () => window.removeEventListener('mousemove', onMouse);
    }, []);

    // ── VK opener: focuses Discord text field, asks VK for input, injects result
    const openVKForWebview = useCallback(async () => {
      if (!webviewRef.current || vkOpenRef.current) return;
      let currentText = '';
      try {
        currentText = await webviewRef.current.executeJavaScript(`
          (function(){
            const el = document.activeElement;
            if (!el) return '';
            if (el.tagName==='INPUT'||el.tagName==='TEXTAREA') return el.value||'';
            if (el.isContentEditable) return el.textContent||'';
            return '';
          })()
        `);
      } catch (_) {}

      vkOpenRef.current = true;
      // Blur the webview so keyboard focus returns to the main renderer
      // window, allowing the VK's keydown handler to receive real key events.
      try { webviewRef.current?.blur(); } catch (_) {}
      window.__arqaKB?.open({
        prompt:       'Message',
        initialValue: currentText,
        onCancel: () => {
          vkOpenRef.current = false;
          try { webviewRef.current?.focus(); } catch (_) {}
        },
        onCommit: async text => {
          vkOpenRef.current = false;
          try { webviewRef.current?.focus(); } catch (_) {} // restore webview focus
          if (!webviewRef.current) return;
          const safe = text
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n');
          try {
            await webviewRef.current.executeJavaScript(`
              (function(t){
                const el = document.activeElement;
                if (!el) return;
                el.focus();
                if (el.tagName==='INPUT'||el.tagName==='TEXTAREA') {
                  const d = Object.getOwnPropertyDescriptor(
                    el.tagName==='INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
                    'value'
                  );
                  if (d&&d.set) {
                    d.set.call(el,t);
                    el.dispatchEvent(new Event('input',{bubbles:true}));
                    el.dispatchEvent(new Event('change',{bubbles:true}));
                  }
                } else if (el.isContentEditable) {
                  document.execCommand('selectAll',false,null);
                  document.execCommand('insertText',false,t);
                }
              })('${safe}')
            `);
          } catch (_) {}
        },
      });
    }, []);

    // ── Gamepad → virtual cursor polling loop ───────────────────────────────
    useEffect(() => {
      if (!visible) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }

      // ── Deadzone helpers ────────────────────────────────────────────────────
      // Circular deadzone for a 2-axis stick.
      // Values inside INNER_DEAD are zeroed; outside they are rescaled so the
      // output starts at 0 at the edge of the deadzone (no jump) and reaches
      // 1.0 at OUTER_DEAD (physical max travel ~0.95 on most controllers).
      const INNER_DEAD = 0.15;   // ignore stick noise below this radius
      const OUTER_DEAD = 0.90;   // treat as full deflection above this radius
      const SPD        = 9;

      // Single-axis deadzone for triggers (0–1 range from the hardware).
      const TRIGGER_DEAD = 0.10; // ignore trigger flutter below this value

      const applyStickDeadzone = (rawX, rawY) => {
        const mag = Math.sqrt(rawX * rawX + rawY * rawY);
        if (mag < INNER_DEAD) return [0, 0];
        const clamped = Math.min(mag, OUTER_DEAD);
        const scale   = (clamped - INNER_DEAD) / (OUTER_DEAD - INNER_DEAD);
        // Quadratic response curve: gentle near centre, fast at edges
        const curved  = scale * scale;
        return [(rawX / mag) * curved, (rawY / mag) * curved];
      };

      const applyTriggerDeadzone = v => v < TRIGGER_DEAD ? 0 : (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD);
      // ────────────────────────────────────────────────────────────────────────

      const poll = () => {
        const gps = navigator.getGamepads?.() ?? [];
        const gp  = gps[0] ?? gps[1] ?? gps[2] ?? gps[3];

        if (gp) {
          const wv   = webviewRef.current;
          const rect = wv?.getBoundingClientRect?.() ?? { width: 1280, height: 720 };
          const prev = prevBtns.current;

          const dn = i => !!gp.buttons[i]?.pressed && !prev[i];
          const up = i => !gp.buttons[i]?.pressed  &&  prev[i];

          // Reset VK flag if keyboard was closed without committing
          if (vkOpenRef.current && !window.__arqaVKOpen) vkOpenRef.current = false;

          // While VK is open, skip all cursor movement and webview mouse input.
          // The VK handles its own gamepad navigation; we just need to persist
          // button state and loop.
          const vkActive = vkOpenRef.current || !!window.__arqaVKOpen;

          // While VK is open: translate D-pad + face buttons into synthetic
          // keyboard events so the VK panel can navigate. The webview is
          // blurred at VK-open time so these events reach the main renderer.
          if (vkActive) {
            const kd = key =>
              window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            if (dn(12)) kd('ArrowUp');
            if (dn(13)) kd('ArrowDown');
            if (dn(14)) kd('ArrowLeft');
            if (dn(15)) kd('ArrowRight');
            if (dn(0))  kd('Enter');
            if (dn(1))  kd('Escape');
            if (dn(2))  kd('Backspace');
          }

          // Only send input events once the webview is fully initialised
          const wvOk = wv && wvReadyRef.current && !vkActive;

          // Left stick → cursor (circular deadzone + quadratic curve)
          const [lx, ly] = applyStickDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
          if ((lx || ly) && wvOk) {
            if (!showCursorRef.current) { showCursorRef.current = true; setShowCursor(true); }
            const nx = Math.max(4, Math.min(rect.width  - 4, cursorRef.current.x + lx * SPD));
            const ny = Math.max(4, Math.min(rect.height - 4, cursorRef.current.y + ly * SPD));
            cursorRef.current = { x: nx, y: ny };
            setCursorPos({ x: nx, y: ny });
            // 'mouseMove' is the correct Electron v20+ type (not 'mouseMoved')
            try { wv.sendInputEvent({ type: 'mouseMove', x: Math.round(nx), y: Math.round(ny), modifiers: [] }); } catch (_) {}
          }

          const px = Math.round(cursorRef.current.x);
          const py = Math.round(cursorRef.current.y);

          // LT(6)/RT(7) → scroll (trigger deadzone applied; deltaX/Y only)
          const lt = applyTriggerDeadzone(gp.buttons[6]?.value ?? 0);
          const rt = applyTriggerDeadzone(gp.buttons[7]?.value ?? 0);
          const sd = rt - lt;
          if (Math.abs(sd) > 0 && wvOk) {
            try {
              wv.sendInputEvent({
                type: 'mouseWheel', x: px, y: py,
                deltaX: 0, deltaY: Math.round(sd * 25),
                modifiers: [],
              });
            } catch (_) {}
          }

          // A(0) → left click
          if (dn(0) && wvOk) try { wv.sendInputEvent({ type: 'mouseDown', button: 'left',  x: px, y: py, clickCount: 1, modifiers: [] }); } catch (_) {}
          if (up(0)) {
            if (wvOk) try { wv.sendInputEvent({ type: 'mouseUp', button: 'left',  x: px, y: py, clickCount: 1, modifiers: [] }); } catch (_) {}
            // Auto-open VK if a text field was focused by the click
            if (!vkOpenRef.current) {
              setTimeout(async () => {
                if (!webviewRef.current) return;
                try {
                  const kind = await webviewRef.current.executeJavaScript(`
                    (function(){
                      const el=document.activeElement;
                      if(!el||el===document.body) return null;
                      if(el.tagName==='TEXTAREA') return 'input';
                      if(el.tagName==='INPUT'&&!['button','submit','checkbox','radio','file','image','reset'].includes(el.type)) return 'input';
                      if(el.isContentEditable||el.getAttribute('role')==='textbox') return 'content';
                      return null;
                    })()
                  `);
                  if (kind) openVKForWebview();
                } catch (_) {}
              }, 150);
            }
          }

          // X(2) → right click
          if (dn(2) && wvOk) try { wv.sendInputEvent({ type: 'mouseDown', button: 'right', x: px, y: py, clickCount: 1, modifiers: [] }); } catch (_) {}
          if (up(2) && wvOk) try { wv.sendInputEvent({ type: 'mouseUp',   button: 'right', x: px, y: py, clickCount: 1, modifiers: [] }); } catch (_) {}

          // B(1) → close settings overlay, or exit to launcher
          if (dn(1)) {
            if (showSettingsRef.current) { showSettingsRef.current = false; setShowSettings(false); }
            else if (!window.__arqaVKOpen) window.__arqaNav?.goHome();
          }

          // Y(3) → manually trigger VK (for focused text field)
          if (dn(3) && !vkOpenRef.current) openVKForWebview();

          // Start/Menu(9) → exit to launcher
          if (dn(9)) window.__arqaNav?.goHome();

          // Persist button state for edge detection
          const next = {};
          for (let i = 0; i < gp.buttons.length; i++) next[i] = !!gp.buttons[i]?.pressed;
          prevBtns.current = next;
        }

        rafRef.current = requestAnimationFrame(poll);
      };

      rafRef.current = requestAnimationFrame(poll);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [visible, openVKForWebview]);

    // ── Render ──────────────────────────────────────────────────────────────
    return h('div', { className: `dc-panel dc-embed-panel${showCursor ? ' arqa-controller-mode' : ''}` },

      // Toolbar — only interactive when the panel is active
      h('div', { className: `dc-embed-toolbar${visible ? '' : ' dc-embed-toolbar--hidden'}` },
        h('button', {
          className: 'dc-embed-exit-btn',
          onClick:   () => window.__arqaNav?.goHome(),
          title:     'Back to Arqa  (Esc / B)',
          tabIndex:  visible ? 0 : -1,
        }, '\u2190 Exit Discord'),
        h('span', { className: 'dc-embed-spacer' }),
        h('button', {
          className: 'dc-embed-rp-btn',
          onClick:   () => { showSettingsRef.current = !showSettingsRef.current; setShowSettings(s => !s); },
          title:     'Configure Rich Presence',
          tabIndex:  visible ? 0 : -1,
        }, '\u2699\ufe0f Rich Presence'),
      ),

      // Discord web — always in the DOM so it preloads.
      // position:fixed + 100vw/100vh is set directly here so the element has
      // the correct compositor box from the very first DOM insertion. Electron
      // allocates the guest-view viewport at insertion time, so any approach
      // that sets the size *after* (useLayoutEffect, CSS chains, etc.) arrives
      // too late and results in a tiny sliver guest viewport.
      React.createElement('webview', {
        ref:         webviewRef,
        src:         'https://discord.com/app',
        partition:   'persist:discord',
        className:   'dc-embed-webview',
        allowpopups: 'allowpopups',
        style: {
          position: 'fixed',
          top:      0,
          left:     0,
          width:    '100vw',
          height:   '100vh',
          border:   'none',
          zIndex:   999998, // just below dc-panel-overlay (999999) so toolbar/cursor stay on top
        },
      }),

      // Virtual cursor overlay — hidden while VK is open
      visible && showCursor && !vkOpenRef.current && !window.__arqaVKOpen && h('div', { className: 'dc-cursor-layer' },
        h('div', {
          className: 'dc-virtual-cursor',
          style: { transform: `translate(${Math.round(cursorPos.x)}px,${Math.round(cursorPos.y)}px)` },
        })
      ),

      // Rich Presence settings
      showSettings && h(RichPresenceSettings, {
        onClose: () => { showSettingsRef.current = false; setShowSettings(false); },
      })
    );
  }

  window.DiscordPanel = DiscordPanel;
})();
