const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = React;
const h = React.createElement;

// ========== WEBGL WAVE RENDERER (PS3 XMB Style) ==========

class WebGLWaveRenderer {
  constructor(canvas, theme = 'dark') {
    this.canvas = canvas;
    this.context = canvas.getContext('webgl') || canvas.getContext('webgl2');
    this.theme = theme;
    this.shaderProgram = null;
    this.vertexShader = null;
    this.fragmentShader = null;
    this.vertexBuffer = null;
    this.startTime = Date.now();
    this.animationFrame = null;
    
    if (!this.context) {
      console.warn('WebGL not supported');
      return;
    }
    
    this.initializeWebGL();
  }
  
  initializeWebGL() {
    const vertexShaderSource = `
      attribute vec2 aVertexPosition;
      void main() {
        gl_Position = vec4(aVertexPosition, 0.0, 1.0);
      }
    `;
    
    const fragmentShaderSource = `
      precision mediump float;
      
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      
      void main() {
        vec2 uv = gl_FragCoord.xy / uResolution;
        float time = uTime * 0.15; // slower, more elegant movement
        
        // Soft horizontal flowing layers - PS3 XMB style
        float wave1 = sin(uv.x * 1.8 + time * 0.6) * 0.12;
        float wave2 = sin(uv.x * 2.4 + time * 0.85 + 1.5) * 0.085;
        float wave3 = cos(uv.x * 1.3 + time * 0.45 + 3.0) * 0.11;
        
        // Very subtle vertical modulation
        float vMod = sin(uv.y * 8.0 + time * 0.3) * 0.008;
        
        float d1 = abs(uv.y - 0.42 - wave1 - vMod) * 9.0;
        float d2 = abs(uv.y - 0.58 - wave2 + vMod * 1.2) * 8.5;
        float d3 = abs(uv.y - 0.31 - wave3) * 10.0;
        
        // Soft glowing bands
        float line1 = smoothstep(0.22, 0.0, d1) * 0.75;
        float line2 = smoothstep(0.18, 0.0, d2) * 0.65;
        float line3 = smoothstep(0.25, 0.0, d3) * 0.55;
        
        float combined = max(max(line1, line2), line3);
        
        if (combined < 0.02) {
          discard;
        }
        
        // Elegant color mixing - deep purple/blue tones like PS3
        vec3 col = mix(uColor1, uColor2, uv.y * 0.6 + sin(time * 0.2) * 0.15);
        col += vec3(0.15, 0.08, 0.35) * combined; // subtle glow boost
        
        gl_FragColor = vec4(col, combined * 0.65);
      }
    `;
    
    this.vertexShader = this.compileShader(vertexShaderSource, this.context.VERTEX_SHADER);
    this.fragmentShader = this.compileShader(fragmentShaderSource, this.context.FRAGMENT_SHADER);
    
    if (!this.vertexShader || !this.fragmentShader) {
      console.error('Shader compilation failed - WebGL waves disabled');
      return;
    }
    
    this.shaderProgram = this.context.createProgram();
    this.context.attachShader(this.shaderProgram, this.vertexShader);
    this.context.attachShader(this.shaderProgram, this.fragmentShader);
    this.context.linkProgram(this.shaderProgram);
    
    if (!this.context.getProgramParameter(this.shaderProgram, this.context.LINK_STATUS)) {
      console.error('Shader program link error:', this.context.getProgramInfoLog(this.shaderProgram));
      return;
    }
    
    this.context.useProgram(this.shaderProgram);
    
    const posLoc = this.context.getAttribLocation(this.shaderProgram, 'aVertexPosition');
    this.timeUniformLocation = this.context.getUniformLocation(this.shaderProgram, 'uTime');
    this.resolutionUniformLocation = this.context.getUniformLocation(this.shaderProgram, 'uResolution');
    this.color1UniformLocation = this.context.getUniformLocation(this.shaderProgram, 'uColor1');
    this.color2UniformLocation = this.context.getUniformLocation(this.shaderProgram, 'uColor2');
    
    this.vertexBuffer = this.context.createBuffer();
    this.context.bindBuffer(this.context.ARRAY_BUFFER, this.vertexBuffer);
    const verts = new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]);
    this.context.bufferData(this.context.ARRAY_BUFFER, verts, this.context.STATIC_DRAW);
    this.context.enableVertexAttribArray(posLoc);
    this.context.vertexAttribPointer(posLoc, 2, this.context.FLOAT, false, 0, 0);
    
    this.context.enable(this.context.BLEND);
    this.context.blendFunc(this.context.SRC_ALPHA, this.context.ONE_MINUS_SRC_ALPHA);
    this.context.clearColor(0.0, 0.0, 0.0, 0.0);
    
    // PS3-inspired deep purple gradient
    this.setColors('#4a2b8c', '#8b5cf6');
    
    this.resizeCanvas();
    this.startAnimation();
  }
  
  compileShader(source, type) {
    const shader = this.context.createShader(type);
    this.context.shaderSource(shader, source);
    this.context.compileShader(shader);
    
    if (!this.context.getShaderParameter(shader, this.context.COMPILE_STATUS)) {
      const error = this.context.getShaderInfoLog(shader);
      console.error('Shader compilation error:', error);
      console.error('Shader source:', source);
      this.context.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.context.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  
  setColors(color1, color2) {
    const c1 = this.hexToVec3(color1);
    const c2 = this.hexToVec3(color2);
    if (this.color1UniformLocation) this.context.uniform3f(this.color1UniformLocation, c1.x, c1.y, c1.z);
    if (this.color2UniformLocation) this.context.uniform3f(this.color2UniformLocation, c2.x, c2.y, c2.z);
  }
  
  hexToVec3(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      x: parseInt(result[1], 16) / 255,
      y: parseInt(result[2], 16) / 255,
      z: parseInt(result[3], 16) / 255
    } : { x: 0.4, y: 0.2, z: 0.8 };
  }
  
  startAnimation() {
    const render = () => {
      this.context.clear(this.context.COLOR_BUFFER_BIT);
      
      const timeSec = (Date.now() - this.startTime) * 0.001;
      this.context.uniform1f(this.timeUniformLocation, timeSec);
      this.context.uniform2f(this.resolutionUniformLocation, this.canvas.width, this.canvas.height);
      this.context.drawArrays(this.context.TRIANGLE_STRIP, 0, 4);
      
      this.animationFrame = requestAnimationFrame(render);
    };
    
    this.animationFrame = requestAnimationFrame(render);
  }
  
  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (!this.context) return;
    if (this.shaderProgram) this.context.deleteProgram(this.shaderProgram);
    if (this.vertexShader) this.context.deleteShader(this.vertexShader);
    if (this.fragmentShader) this.context.deleteShader(this.fragmentShader);
    if (this.vertexBuffer) this.context.deleteBuffer(this.vertexBuffer);
  }
}

// ========== UTILITY FUNCTIONS ==========

/** Safely wrap index with bounds checking */
const clampWrap = (index, length) => {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
};

/** Format a ROM filename into a readable title */
const formatRomName = (filename) => {
  return filename
    .replace(/\.[^/.]+$/, '')           // strip extension
    .replace(/[._-]+/g, ' ')            // replace separators with spaces
    .replace(/\s+/g, ' ')              // collapse multiple spaces
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()); // title case
};

/** Check if two button arrays have same state (for gamepad edge detection) */
const gamepadStateChanged = (prev, current) => {
  if (prev.length !== current.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== current[i]) return true;
  }
  return false;
};

/** Input cooldown tracker - prevents repeat spam */
class InputCooldown {
  constructor() {
    this.timers = {};
  }
  
  isReady(key, ms = 120) {
    if (!this.timers[key]) {
      this.timers[key] = 0;
    }
    const now = Date.now();
    if (now - this.timers[key] >= ms) {
      this.timers[key] = now;
      return true;
    }
    return false;
  }
  
  reset(key) {
    delete this.timers[key];
  }
}

const inputCooldown = new InputCooldown();

const menuItems = [
  { label: 'Games',   icon: './assets/game.png',     description: 'Local Games'         },
  { label: 'Steam',   icon: './assets/download.png', description: 'Steam Library'       },
  { label: 'ROMs',    icon: './assets/resume.png',   description: 'Emulated Games'      },
  { label: 'Apps',    icon: './assets/folder.png',   description: 'Applications'        },
  { label: 'Discord', icon: './assets/discord.png',  description: 'Messaging & Friends' },
  { label: 'Settings', icon: './assets/settings.png', description: 'Options'            },
  { label: 'Power',    icon: './assets/power.png',    description: 'System'             }
];

const PLATFORM_LABELS = {
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  psp: 'PSP',
  gamecube: 'GameCube',
  wii: 'Wii',
  snes: 'SNES',
  nes: 'NES',
  n64: 'Nintendo 64',
  genesis: 'Genesis',
  gba: 'Game Boy Advance',
  gb: 'Game Boy',
  arcade: 'Arcade',
  dreamcast: 'Dreamcast',
  switch: 'Switch',
  unknown: 'Unknown system'
};

// Emoji fallbacks used when a PNG asset file is missing.
const PLATFORM_EMOJI = {
  ps1: '🎮', ps2: '🎮', psp: '🕹️', gamecube: '🎮', wii: '🕹️',
  snes: '🕹️', nes: '🕹️', n64: '🕹️', genesis: '🎮', gba: '👾',
  gb: '👾', arcade: '🕹️', dreamcast: '🎮', switch: '🎮', unknown: '❓'
};
const MENU_EMOJI = {
  // Legacy
  home: '🏠', folder: '📁', playlists: '▶️', settings: '⚙️', power: '⏻',
  // New sections
  game: '🎮', download: '☁️', resume: '🕹️', power: '⏻', discord: '💬'
};

// 🎨 Use image icons from assets folder instead of emojis
const PLATFORM_ICONS = {
  ps1: './assets/ps1.png',
  ps2: './assets/ps2.png',
  psp: './assets/psp.png',
  gamecube: './assets/gamecube.png',
  wii: './assets/wii.png',
  snes: './assets/snes.png',
  nes: './assets/nes.png',
  n64: './assets/n64.png',
  genesis: './assets/genesis.png',
  gba: './assets/gba.png',
  gb: './assets/gb.png',
  arcade: './assets/arcade.png',
  dreamcast: './assets/dreamcast.png',
  switch: './assets/switch.png',
  unknown: './assets/unknown.png'
};

// 🎨 Action and menu icons (replacing emojis)
const ACTION_ICONS = {
  bazzite: './assets/game.png',
  folder: './assets/folder.png',
  rom: './assets/game.png',
  status: './assets/notification.png',
  recent: './assets/resume.png',
  stop: './assets/power.png',
  launch: './assets/resume.png',
  navigation: './assets/pointer_hand.png',
  confirm: './assets/pointer_click.png',
  back: './assets/pointer_hand.png',
  gamescope: './assets/settings.png',
  clear: './assets/notification.png',
  remove: './assets/notification.png',
  power: './assets/power.png'
};

// 🎨 Unique icon per power action
const POWER_ICONS = {
  quit:     './assets/power.png',
  restart:  './assets/resume.png',
  sleep:    './assets/subsettings/power-save-settings.png',
  shutdown: './assets/power.png'
};

const POWER_LABELS = {
  quit: 'Quit Launcher',
  restart: 'Restart Arqa',
  sleep: 'Sleep',
  shutdown: 'Shut Down'
};

// ========== VIRTUAL KEYBOARD ==========

const VK_ROWS_LOWER = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
  ['CAPS','@','.','-','_','(',')','/','DEL','SPACE','DONE'],
];
const VK_ROWS_UPPER = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
  ['caps','@','.','-','_','(',')','/','DEL','SPACE','DONE'],
];
const VK_DISPLAY = { DEL: '⌫', SPACE: '␣ Space', DONE: '✓ Done', CAPS: '⇪', caps: '⇪' };

function VirtualKeyboard({ prompt, initialValue, maxLen, isPassword, onCommit, onCancel }) {
  const [caps,   setCaps]   = useState(false);
  const [curRow, setCurRow] = useState(4);
  const [curCol, setCurCol] = useState(9); // start on SPACE
  const [text,   setText]   = useState(initialValue || '');

  const rows = caps ? VK_ROWS_UPPER : VK_ROWS_LOWER;

  // Block all other listeners while keyboard is open
  useEffect(() => {
    window.__arqaVKOpen = true;
    return () => { window.__arqaVKOpen = false; };
  }, []);

  const pressKey = useCallback((key) => {
    switch (key) {
      case 'CAPS': case 'caps': setCaps(c => !c); return;
      case 'DEL':   setText(t => t.slice(0, -1)); return;
      case 'SPACE': setText(t => t.length < maxLen ? t + ' ' : t); return;
      case 'DONE':  onCommit(text); return;
      default:      setText(t => t.length < maxLen ? t + key : t);
    }
  }, [text, maxLen, onCommit]);

  useEffect(() => {
    const handler = (e) => {
      const row = rows[curRow];
      if (!row) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      switch (e.key) {
        case 'ArrowLeft':
          setCurCol(c => Math.max(0, c - 1)); break;
        case 'ArrowRight':
          setCurCol(c => Math.min(row.length - 1, c + 1)); break;
        case 'ArrowUp':
          if (curRow > 0) {
            const pr = rows[curRow - 1];
            setCurRow(r => r - 1);
            setCurCol(c => Math.min(c, pr.length - 1));
          } break;
        case 'ArrowDown':
          if (curRow < rows.length - 1) {
            const nr = rows[curRow + 1];
            setCurRow(r => r + 1);
            setCurCol(c => Math.min(c, nr.length - 1));
          } break;
        case 'Enter':
          pressKey(row[curCol]); break;
        case 'Backspace':
          setText(t => t.slice(0, -1)); break;
        case 'Escape':
          onCancel(); break;
        default:
          // Ctrl+V / Cmd+V — read clipboard directly because preventDefault() above
          // suppresses the browser's paste event, so the paste listener never fires.
          if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
            navigator.clipboard?.readText().then(text => {
              if (!text) return;
              setText(prev => (prev + text.replace(/[\r\n\t]/g, ' ').trimEnd()).slice(0, maxLen));
            }).catch(() => {});
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            setText(t => t.length < maxLen ? t + e.key : t);
          }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [curRow, curCol, rows, pressKey, onCancel, maxLen]);

  const displayText = isPassword ? '\u2022'.repeat(text.length) : text;

  return h('div', { className: 'vk-overlay' },
    h('div', { className: 'vk-panel' },
      h('div', { className: 'vk-prompt' }, prompt),
      h('div', { className: 'vk-input-display' },
        h('span', { className: 'vk-input-text' },
          displayText || h('span', { className: 'vk-placeholder' }, 'Start typing\u2026')
        ),
        h('span', { className: 'vk-cursor' }, '\u2502')
      ),
      h('div', { className: 'vk-rows' },
        ...rows.map((row, ri) =>
          h('div', { key: ri, className: 'vk-row' },
            ...row.map((key, ci) => {
              const focused = ri === curRow && ci === curCol;
              return h('button', {
                key:       `${ri}-${ci}`,
                tabIndex:  -1,
                className: [
                  'vk-key',
                  focused ? 'vk-key-focused' : '',
                  key === 'DONE'                      ? 'vk-key-done'  : '',
                  key === 'SPACE'                     ? 'vk-key-space' : '',
                  key === 'DEL'                       ? 'vk-key-del'   : '',
                  key === 'CAPS' || key === 'caps'    ? `vk-key-caps${caps ? ' vk-key-caps-on' : ''}` : '',
                ].filter(Boolean).join(' '),
                onClick: () => pressKey(key),
              }, VK_DISPLAY[key] || key);
            })
          )
        )
      ),
      h('div', { className: 'vk-footer' },
        h('span', { className: 'vk-footer-hint' }, '\u2190\u2192\u2191\u2193 move'),
        h('span', { className: 'vk-footer-hint' }, '\u21b5 type'),
        h('span', { className: 'vk-footer-hint' }, '\u232b delete'),
        h('span', { className: 'vk-footer-hint' }, 'Esc cancel'),
      )
    )
  );
}

// ========== ERROR BOUNDARY ==========

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ArqaLauncher render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', {
        style: {
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center', gap: '16px',
          background: '#05030c', color: '#ff5c7a', fontFamily: 'monospace',
          padding: '32px', textAlign: 'center'
        }
      },
        React.createElement('span', { style: { fontSize: '2rem' } }, '\u26a0'),
        React.createElement('p', { style: { fontSize: '1rem', color: '#c9a3ff', margin: 0 } }, 'A render error occurred.'),
        React.createElement('pre', {
          style: { fontSize: '0.75rem', color: '#8a7ac0', maxWidth: '600px', overflowX: 'auto', textAlign: 'left' }
        }, String(this.state.error))
      );
    }
    return this.props.children;
  }
}

const App = () => {
  const [activeSection, setActiveSection] = useState('Games');
  const [focusArea, setFocusArea] = useState('menu');
  const [subIndex, setSubIndex] = useState(0);
  const [delayedPreviewIndex, setDelayedPreviewIndex] = useState(0);
  const [bazzitePath, setBazzitePath] = useState(null);
  const [library, setLibrary] = useState(null);
  const [selectedRom, setSelectedRom] = useState(null);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState('Idle');
  const [consoleLog, setConsoleLog] = useState(['Ready.']);
  const [consoleState, setConsoleState] = useState('Awaiting launch');
  const [logExpanded, setLogExpanded] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [useGamescope, setUseGamescope] = useState(true);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [pendingPower, setPendingPower] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [flashItemId, setFlashItemId] = useState(null);
  const [librarySearch, setLibrarySearch] = useState('');

  // ── XMB Game Registry & Preview State ──────────────────────────────────────
  // xmbGames mirrors the Library ROM scan as canonical game objects (GameRegistry).
  const [xmbGames, setXmbGames] = useState([]);
  // bgState drives the dynamic background layer (video / image / gradient).
  const [bgState, setBgState] = useState({
    type: 'gradient', source: null, color: '#7b4dff', active: false
  });
  // True while the delayed preview background is visible for the focused game.
  const [previewActive, setPreviewActive] = useState(false);

  // ── Content-type state (populated by IPC scans) ─────────────────────────────
  const [steamGames,     setSteamGames]     = useState([]);  // Steam library entries
  const [localGames,     setLocalGames]     = useState([]);  // Local .exe/.AppImage games
  const [romGames,       setRomGames]       = useState([]);  // Multi-dir ROM scan results
  const [appItems,       setAppItems]       = useState([]);  // App directory entries
  const [platformInfo,   setPlatformInfo]   = useState(null);// OS / platform metadata
  const [steamScanState, setSteamScanState] = useState('idle'); // idle|scanning|done|error
  const [romScanState,   setRomScanState]   = useState('idle');

  // Discord state
  const [discordUnread,     setDiscordUnread]     = useState(0);
  const [discordAuthStatus, setDiscordAuthStatus] = useState({ authenticated: false, user: null, connected: false });
  const [discordEntered,    setDiscordEntered]    = useState(false); // true = panel is open
  const discordEnteredRef = useRef(false);
  // Sync ref for use inside effect closures
  useEffect(() => { discordEnteredRef.current = discordEntered; }, [discordEntered]);
  // Collapse Discord panel whenever the user navigates to a different section
  useEffect(() => { if (activeSection !== 'Discord') setDiscordEntered(false); }, [activeSection]);

  // Dynamic background state
  const [glowIntensity, setGlowIntensity] = useState(1);
  const [lastInputDirection, setLastInputDirection] = useState(null);

  // WebGL Wave Renderer
  const waveRendererRef = useRef(null);
  const waveCanvasRef = useRef(null);

  // Consolidated latest-state ref (replaces 9 individual synced refs)
  const activeSectionRef = useRef(activeSection);
  const focusAreaRef = useRef(focusArea);
  const subIndexRef = useRef(subIndex);
  const libraryRef = useRef(library);
  const selectedRomRef = useRef(selectedRom);
  const bazzitePathRef = useRef(bazzitePath);
  const useGamescopeRef = useRef(useGamescope);
  const statusRef = useRef(status);

  // Subindex memory per section (persists scroll position when switching sections)
  const sectionSubIndexRef = useRef({});

  // Library search
  const librarySearchRef = useRef('');
  const librarySearchTimeoutRef = useRef(null);

  // Direction of last section transition ('left' | 'right' | 'none')
  const transitionDirRef = useRef('none');

  // Console log DOM ref for auto-scroll
  const consoleLogRef = useRef(null);

  // Audio refs
  const menuMusicRef = useRef(null);
  const navSound1Ref = useRef(null);
  const navSound2Ref = useRef(null);
  const invalidSoundRef = useRef(null);
  const selectSoundRef = useRef(null);
  const menuBarRef = useRef(null);
  const submenuAreaRef = useRef(null);
  const subColumnRef = useRef(null);  // ref for .xmb-sub-column, used for auto-scroll
  // Background layer video element for game previews.
  const bgVideoRef = useRef(null);

  // Virtual keyboard state: null = hidden, object = visible
  const [vkState, setVkState] = useState(null);

  // Gamepad state tracking
  const lastGamepadButtonState = useRef(Array(16).fill(false));
  const lastGamepadAnalogState = useRef({ x: 0, y: 0 });
  const gamepadPollRef = useRef(null);

  // Cleanup refs
  const pendingPowerTimeout = useRef(null);
  const sectionItemsRef = useRef([]);
  const pendingPowerRef = useRef(null);

  // Hold-scroll acceleration for library navigation
  const holdScrollRef = useRef({ key: null, timer: null, count: 0 });
  // Live mirror of xmbGames for use inside stale-closure effects
  const xmbGamesRef = useRef([]);

  // Single synchronous layout-effect keeps all stale-closure refs current after every render
  useLayoutEffect(() => {
    activeSectionRef.current = activeSection;
    focusAreaRef.current = focusArea;
    subIndexRef.current = subIndex;
    libraryRef.current = library;
    selectedRomRef.current = selectedRom;
    bazzitePathRef.current = bazzitePath;
    useGamescopeRef.current = useGamescope;
    statusRef.current = status;
    librarySearchRef.current = librarySearch;
    xmbGamesRef.current = xmbGames;
    // Save subIndex per section so we can restore it when switching back
    sectionSubIndexRef.current[activeSection] = subIndex;
  });
  // pendingPowerRef is managed directly by confirmOrRun for immediate consistency

  // Dynamic menu centering
  useEffect(() => {
    const positionMenu = () => {
      if (!menuBarRef.current || !submenuAreaRef.current) return;
      const items = menuBarRef.current.children;
      if (items.length === 0) return;

      const activeIndex = Math.max(menuItems.findIndex((item) => item.label === activeSection), 0);
      const activeItem = items[activeIndex];
      if (!activeItem) return;

      const itemRect = activeItem.getBoundingClientRect();
      const containerRect = menuBarRef.current.getBoundingClientRect();
      const anchorRect = submenuAreaRef.current.getBoundingClientRect();

      const itemOffsetInRow = itemRect.left - containerRect.left;
      const targetTranslate = anchorRect.left - itemOffsetInRow;

      menuBarRef.current.style.transform = `translateX(${targetTranslate}px)`;
    };

    positionMenu();

    let resizeFrame = null;
    const onResize = () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(positionMenu);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
    };
  }, [activeSection]);

  // Append to console log with timestamp, capped at 200 lines
  const appendConsole = (message) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setConsoleLog((prev) => {
      const next = [...prev, `[${ts}] ${message}`];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  };

  // 🎵 Navigation sound - randomly chooses between nav1.wav and nav2.wav
  const playNavigationSound = () => {
    try {
      const navRefs = [navSound1Ref, navSound2Ref];
      const randomRef = navRefs[Math.floor(Math.random() * navRefs.length)];
      
      if (randomRef.current) {
        randomRef.current.currentTime = 0;
        const playPromise = randomRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => console.warn('Nav sound play failed:', err));
        }
      }
    } catch (err) {
      console.warn('Error playing nav sound:', err);
    }
  };

  // 🎵 Valid selection sound
  const playSelectSound = () => {
    try {
      if (selectSoundRef.current) {
        selectSoundRef.current.currentTime = 0;
        const playPromise = selectSoundRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => console.warn('Select sound play failed:', err));
        }
      }
    } catch (err) {
      console.warn('Error playing select sound:', err);
    }
  };

  // 🎵 Invalid selection sound
  const playInvalidSound = () => {
    try {
      if (invalidSoundRef.current) {
        invalidSoundRef.current.currentTime = 0;
        const playPromise = invalidSoundRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => console.warn('Invalid sound play failed:', err));
        }
      }
    } catch (err) {
      console.warn('Error playing invalid sound:', err);
    }
  };

  const playBackSound = () => {
    try {
      playNavigationSound();
    } catch (err) {
      console.warn('Error playing back sound:', err);
    }
  };

  // Initialize WebGL wave renderer
  useEffect(() => {
    if (!waveCanvasRef.current) return;
    
    try {
      waveRendererRef.current = new WebGLWaveRenderer(waveCanvasRef.current, 'dark');
      if (waveRendererRef.current && waveRendererRef.current.context) {
        waveRendererRef.current.setColors('#7b4dff', '#b389ff');
      }
    } catch (err) {
      console.warn('WebGL initialization failed, falling back to CSS waves:', err);
    }
    
    const handleResize = () => {
      if (waveRendererRef.current && waveRendererRef.current.context) {
        waveRendererRef.current.resizeCanvas();
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (waveRendererRef.current) {
        waveRendererRef.current.destroy();
        waveRendererRef.current = null;
      }
    };
  }, []);

  // Smooth glow intensity decay
  useEffect(() => {
    if (Math.abs(glowIntensity - 1) < 0.01) {
      setGlowIntensity(1);
      return;
    }
    const timer = setTimeout(() => {
      setGlowIntensity((prev) => {
        const target = focusArea === 'submenu' ? 1.15 : 1;
        const decayed = prev + (target - prev) * 0.15;
        return Math.abs(decayed - target) < 0.02 ? target : decayed;
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [glowIntensity, focusArea]);

  // Clear input direction indicator
  useEffect(() => {
    if (!lastInputDirection) return;
    const timer = setTimeout(() => setLastInputDirection(null), 300);
    return () => clearTimeout(timer);
  }, [lastInputDirection]);

  // Boot sequence
  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Expose virtual keyboard trigger for external components (e.g. discordPanel)
  useEffect(() => {
    window.__arqaKB = { open: (cfg) => setVkState(cfg), close: () => setVkState(null) };
    return () => { delete window.__arqaKB; };
  }, []);

  // Scroll focused submenu item into view whenever subIndex or focusArea changes
  useEffect(() => {
    if (focusArea !== 'submenu' || !subColumnRef.current) return;
    const focused = subColumnRef.current.querySelector('.xmb-sub-item.focused');
    if (focused) focused.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [subIndex, focusArea]);

  // Menu music — starts after the boot splash fades, respects browser autoplay policy
  useEffect(() => {
    if (booting) return;
    const music = menuMusicRef.current;
    if (!music) return;
    music.volume = 0.35;
    const p = music.play();
    if (p) p.catch(() => {}); // silently ignore autoplay block
  }, [booting]);

  // Pause music when window loses focus (game launched / alt-tabbed), resume on return
  useEffect(() => {
    const music = menuMusicRef.current;
    if (!music) return;

    const onHide = () => { if (!music.paused) music.pause(); };
    const onShow = () => {
      if (music.paused && !booting) {
        const p = music.play();
        if (p) p.catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.hidden) onHide(); else onShow();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('focus', onShow);
    };
  }, [booting]);

  // Console auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (logExpanded && consoleLogRef.current) {
      consoleLogRef.current.scrollTop = consoleLogRef.current.scrollHeight;
    }
  }, [consoleLog, logExpanded]);

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Delayed preview index for XMB feel
  useEffect(() => {
    const timer = setTimeout(() => {
      setDelayedPreviewIndex(subIndex);
    }, 150);
    return () => clearTimeout(timer);
  }, [subIndex]);

  useEffect(() => {
    if (!window.arqaAPI) {
      appendConsole('Warning: Arqa system API not available — running in preview mode.');
      return;
    }

    (async () => {
      const loaded = await window.arqaAPI.getSettings();
      if (!loaded) return;

      if (loaded.bazzitePath) {
        setBazzitePath(loaded.bazzitePath);
        setStatus('Bazzite ready');
      }
      setUseGamescope(loaded.useGamescope !== false);
      setRecentlyPlayed(loaded.recentlyPlayed || []);

      if (loaded.libraryFolder) {
        setLibraryLoading(true);
        const result = await window.arqaAPI.rescanLibrary(loaded.libraryFolder);
        setLibraryLoading(false);
        if (result && !result.error) {
          setLibrary(result);
          appendConsole(`Restored library: ${result.roms.length} title(s) from ${result.folderPath}`);
        } else if (result?.error) {
          appendConsole(result.error);
        }
      }
    })();

    window.arqaAPI.onOutput((data) => appendConsole(data.toString().trim()));
    window.arqaAPI.onExit(async (code) => {
      appendConsole(`Process exited with code ${code}`);
      setStatus(code === 0 || code === null ? 'Idle' : 'Stopped');
      setConsoleState('Awaiting launch');
      const refreshed = await window.arqaAPI.getSettings();
      setRecentlyPlayed(refreshed?.recentlyPlayed || []);
      // Restore idle Rich Presence when game exits
      window.arqaAPI.discord?.setIdlePresence().catch(() => {});
    });

    // Discord auth status — load once and keep in sync with gateway events
    if (window.arqaAPI?.discord) {
      window.arqaAPI.discord.authStatus().then(s => {
        if (s) setDiscordAuthStatus(s);
      }).catch(() => {});
      window.arqaAPI.discord.onReady(d => {
        setDiscordAuthStatus(prev => ({ ...prev, connected: true, user: d?.user || prev.user }));
      });
      window.arqaAPI.discord.onDisconnected(() => {
        setDiscordAuthStatus(prev => ({ ...prev, connected: false }));
      });
      window.arqaAPI.discord.onReconnected(() => {
        setDiscordAuthStatus(prev => ({ ...prev, connected: true }));
      });
    }
  }, []);

  // ── Section-aware xmbGames derivation ────────────────────────────────────
  // Returns the canonical game array for whichever section is active.
  // Games / Steam / ROMs / Apps all use the horizontal strip; others do not.
  const STRIP_SECTIONS = ['Games', 'Steam', 'ROMs', 'Apps'];
  function getGamesForSection(section) {
    switch (section) {
      case 'Games': return localGames;
      case 'Steam': return steamGames;
      case 'ROMs':  return romGames.length ? romGames
                         : (library?.roms?.length ? GameRegistry.fromRomScan(library) : []);
      case 'Apps':  return appItems;
      default:      return [];
    }
  }

  useEffect(() => {
    const games = getGamesForSection(activeSection);
    setXmbGames(games);
    if (games.length) AssetResolver.warmCache(games, 0, 3);
    // For ROMs: try overlay with library.json manifest
    if (activeSection === 'ROMs' && library?.folderPath && window.arqaAPI?.loadLibraryManifest) {
      window.arqaAPI.loadLibraryManifest(library.folderPath).then(manifest => {
        if (manifest && !manifest.error) {
          setXmbGames(prev => GameRegistry.mergeManifest(prev, manifest));
        }
      });
    }
    // Reset background when leaving a strip section
    if (!STRIP_SECTIONS.includes(activeSection)) {
      setBgState({ type: 'gradient', source: null, color: '#7b4dff', active: false });
      setPreviewActive(false);
      PreviewSystem.cancel();
    }
  }, [activeSection, localGames, steamGames, romGames, appItems, library]);

  // ── Trigger background preview when focused item changes in a strip section ─
  useEffect(() => {
    if (!STRIP_SECTIONS.includes(activeSection) || xmbGames.length === 0) {
      PreviewSystem.cancel();
      setBgState(prev => ({ ...prev, active: false }));
      setPreviewActive(false);
      return;
    }

    const game = xmbGames[subIndex];
    if (!game) return;

    AssetResolver.warmCache(xmbGames, subIndex, 2);
    setPreviewActive(false);

    PreviewSystem.schedulePreview(
      () => {
        const bg = AssetResolver.resolveBackground(game);
        setBgState({ ...bg, active: true });
        setPreviewActive(true);
      },
      null
    );

    return () => { PreviewSystem.cancel(); };
  }, [subIndex, activeSection, xmbGames]);

  // ── Manage the background <video> element src / playback ──────────────────
  useEffect(() => {
    const video = bgVideoRef.current;
    if (!video) return;
    if (bgState.active && bgState.type === 'video' && bgState.source) {
      PreviewSystem.prepareVideoElement(video, bgState.source);
      PreviewSystem.playVideo(video);
    } else {
      PreviewSystem.pauseVideo(video);
    }
  }, [bgState]);

  // ── Startup: fetch platform info + auto-scan Steam / saved ROM dirs ────────
  useEffect(() => {
    if (!window.arqaAPI) return;

    // Fetch platform metadata
    window.arqaAPI.platformInfo().then(info => {
      if (info) setPlatformInfo(info);
    }).catch(() => {});

    // Auto-scan Steam (non-blocking)
    const settings = window.arqaAPI.getSettings().then(saved => {
      if (!saved) return;
      if (saved.enableSteamScan !== false) {
        setSteamScanState('scanning');
        window.arqaAPI.scanSteamLibrary(saved.steamPath || null).then(result => {
          setSteamScanState(result?.error ? 'error' : 'done');
          if (result?.entries?.length) {
            setSteamGames(result.entries);
            ContentRegistry.setCategory('Steam', result.entries);
          }
        }).catch(() => setSteamScanState('error'));
      }

      // Auto-scan saved ROM directories
      if (saved.romDirectories?.length) {
        setRomScanState('scanning');
        window.arqaAPI.scanRomDirectories(saved.romDirectories).then(result => {
          setRomScanState(result?.error ? 'error' : 'done');
          if (result?.entries?.length) {
            setRomGames(result.entries);
            ContentRegistry.setCategory('ROMs', result.entries);
          }
        }).catch(() => setRomScanState('error'));
      }

      // Auto-scan saved app directories
      if (saved.appDirectories?.length) {
        Promise.all(
          saved.appDirectories.map(d => window.arqaAPI.scanAppDirectory(d))
        ).then(results => {
          const all = results.flatMap(r => r?.entries || []);
          if (all.length) { setAppItems(all); ContentRegistry.setCategory('Apps', all); }
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const getCurrentIndex = () => menuItems.findIndex((item) => item.label === activeSectionRef.current);

    const jumpToSection = (nextSection, dir = 'none') => {
      transitionDirRef.current = dir;
      // Clear library search when leaving ROMs (was Library)
      if ((activeSectionRef.current === 'ROMs' || activeSectionRef.current === 'Library') && nextSection !== activeSectionRef.current) {
        setLibrarySearch('');
        librarySearchRef.current = '';
        clearTimeout(librarySearchTimeoutRef.current);
      }
      playNavigationSound();
      setActiveSection(nextSection);
      setFocusArea('menu');
      setSubIndex(sectionSubIndexRef.current[nextSection] ?? 0);
    };

    const handleInput = (input) => {
      if (!inputCooldown.isReady(input, input.includes('Arrow') ? 100 : 80)) return;

      const currentFocus = focusAreaRef.current;
      const currentItems = sectionItemsRef.current;
      const itemCount = currentItems.length;

      switch (input) {
        case 'ArrowLeft':
          setLastInputDirection('left');
          if (currentFocus === 'menu') {
            const nextIdx = clampWrap(getCurrentIndex() - 1, menuItems.length);
            jumpToSection(menuItems[nextIdx].label, 'left');
          } else if (itemCount > 0) {
            playNavigationSound();
            setSubIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'ArrowRight':
          setLastInputDirection('right');
          if (currentFocus === 'menu') {
            const nextIdx = clampWrap(getCurrentIndex() + 1, menuItems.length);
            jumpToSection(menuItems[nextIdx].label, 'right');
          } else if (itemCount > 0) {
            playNavigationSound();
            setSubIndex((prev) => Math.min(prev + 1, itemCount - 1));
          }
          break;
        case 'ArrowUp':
          playNavigationSound();
          // Strip sections: Up always exits back to the menu bar (XMB-style vertical axis)
          if (currentFocus === 'submenu' && STRIP_SECTIONS.includes(activeSectionRef.current)) {
            setFocusArea('menu');
          } else if (currentFocus === 'submenu' && subIndexRef.current === 0) {
            setFocusArea('menu');
          } else if (currentFocus === 'submenu') {
            setSubIndex((prev) => clampWrap(prev - 1, itemCount));
          }
          break;
        case 'ArrowDown':
          playNavigationSound();
          if (activeSectionRef.current === 'Discord') {
            // ArrowDown explicitly opens the Discord panel
            setDiscordEntered(true);
            discordEnteredRef.current = true;
          } else if (currentFocus === 'menu' && itemCount > 0) {
            setFocusArea('submenu');
          } else if (currentFocus === 'submenu' && itemCount > 0) {
            setSubIndex((prev) => clampWrap(prev + 1, itemCount));
          }
          break;
        case 'Enter': {
          if (currentFocus === 'submenu') {
            const item = currentItems[subIndexRef.current];
            if (item?.action && !item.disabled) {
              playSelectSound();
              setFlashItemId(item.id);
              setTimeout(() => setFlashItemId(null), 320);
              item.action();
            } else {
              playInvalidSound();
            }
          }
          break;
        }
        case 'Back':
        case 'Escape':
          // If library search is active, clear it first before navigating back
          if (librarySearchRef.current) {
            setLibrarySearch('');
            librarySearchRef.current = '';
            clearTimeout(librarySearchTimeoutRef.current);
          } else {
            playBackSound();
            if (focusAreaRef.current === 'submenu') {
              setFocusArea('menu');
            } else {
              jumpToSection('Games');
            }
          }
          break;
        default: {
          // Number keys 1–5 jump directly to the matching section
          const num = parseInt(input, 10);
          if (!isNaN(num) && num >= 1 && num <= menuItems.length) {
            jumpToSection(menuItems[num - 1].label);
          }
          break;
        }
      }
    };

    const onKeyDown = (event) => {
      if (window.__arqaVKOpen) return; // virtual keyboard handles its own input
      if (event.repeat) return;

      // When the Discord panel is active, defer ALL navigation to it.
      // Number-key shortcuts (1-7) still work so the user can jump out with keyboard.
      if (activeSectionRef.current === 'Discord' && discordEnteredRef.current) {
        const num = parseInt(event.key, 10);
        if (!isNaN(num) && num >= 1 && num <= menuItems.length) {
          jumpToSection(menuItems[num - 1].label);
        }
        return;
      }

      // VKD search: open virtual keyboard on any printable keypress inside strip submenu
      const inStripSubmenu = ['Games', 'Steam', 'ROMs', 'Apps'].includes(activeSectionRef.current)
        && focusAreaRef.current === 'submenu';
      if (inStripSubmenu && event.key.length === 1 && /^[a-zA-Z0-9 ]$/.test(event.key)) {
        event.preventDefault();
        setVkState({
          prompt: 'Search Library',
          initialValue: event.key === ' ' ? '' : event.key,
          maxLen: 40,
          onCommit: (val) => {
            const q = val.toLowerCase().trim();
            setLibrarySearch(q);
            librarySearchRef.current = q;
            if (q) {
              const idx = xmbGamesRef.current.findIndex(g => g.title?.toLowerCase().includes(q));
              if (idx >= 0) setSubIndex(idx);
            }
          },
          onCancel: () => {},
        });
        return;
      }

      // Hold-scroll: start accelerating repeat on left/right in strip submenu.
      // Only real (trusted) key events start the keyboard hold timer — gamepad-dispatched
      // events (isTrusted=false) are managed exclusively by gpHold ticks to avoid double-firing.
      if (inStripSubmenu && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        handleInput(event.key); // immediate first move (cooldown gates rapid spam)
        if (event.isTrusted) {
          const hs = holdScrollRef.current;
          if (hs.timer) { clearTimeout(hs.timer); hs.timer = null; }
          hs.key = event.key;
          hs.count = 0;
          const tick = () => {
            hs.count++;
            inputCooldown.reset(hs.key); // bypass 100ms gate so 72ms/45ms intervals fire
            handleInput(hs.key);
            const delay = hs.count < 4 ? 260 : hs.count < 10 ? 130 : hs.count < 20 ? 72 : 45;
            hs.timer = setTimeout(tick, delay);
          };
          hs.timer = setTimeout(tick, 380);
        }
        return;
      }

      const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
      const sectionKeys = ['1', '2', '3', '4', '5'];
      if (!navKeys.includes(event.key) && !sectionKeys.includes(event.key)) return;
      if (navKeys.includes(event.key)) event.preventDefault();
      handleInput(event.key);
    };

    const onKeyUp = (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const hs = holdScrollRef.current;
        if (hs.timer) { clearTimeout(hs.timer); hs.timer = null; }
        hs.key = null;
        hs.count = 0;
      }
    };

    // Per-gamepad D-pad hold tracking: { [padIndex]: { [buttonIndex]: { pressTime, count, timer } } }
    const gpHold = {};
    const GP_HOLD_BUTTONS = { 14: 'ArrowLeft', 15: 'ArrowRight' };
    // Analog stick hold — self-contained tick loop, reads gamepad state directly
    const AXIS_DZ         = 0.88;  // outer: must exceed to trigger (near full deflection)
    const AXIS_DZ_RELEASE = 0.70;  // inner: must drop below to stop (hysteresis)
    const analogHold = { dir: null, count: 0, timer: null };

    // Read current left-stick X from any connected gamepad
    const readLX = () => {
      const pads = navigator.getGamepads?.() || [];
      for (const p of pads) { if (p?.axes?.length >= 1) return p.axes[0] || 0; }
      return 0;
    };

    // Start the self-sustaining hold-repeat tick for the analog stick.
    // Called only from the initial edge-detect in pollGamepad.
    const startAnalogHold = (dir) => {
      if (analogHold.timer) { clearTimeout(analogHold.timer); analogHold.timer = null; }
      analogHold.dir   = dir;
      analogHold.count = 0;

      const tick = () => {
        const lx    = readLX();
        const lxAbs = Math.abs(lx);
        // "still holding" = above inner threshold AND same direction
        const stillHeld = lxAbs >= AXIS_DZ_RELEASE
          && (lx > 0 ? 'ArrowRight' : 'ArrowLeft') === analogHold.dir;

        if (stillHeld) {
          // Direct call — bypasses onKeyDown and the 100ms inputCooldown gate
          // so 72ms/45ms fast intervals actually fire.
          inputCooldown.reset(analogHold.dir);
          handleInput(analogHold.dir);
          analogHold.count++;
          const delay = analogHold.count < 4 ? 260 : analogHold.count < 10 ? 130 : analogHold.count < 20 ? 72 : 45;
          analogHold.timer = setTimeout(tick, delay);
        } else {
          // Not holding — stop, then check once after 500ms in case stick is re-pressed
          analogHold.dir   = null;
          analogHold.count = 0;
          analogHold.timer = setTimeout(() => {
            analogHold.timer = null;
            const lx2    = readLX();
            const lx2Abs = Math.abs(lx2);
            if (lx2Abs > AXIS_DZ) {
              // Still held after grace period — fire once then start a fresh hold cycle
              const reDir = lx2 > 0 ? 'ArrowRight' : 'ArrowLeft';
              inputCooldown.reset(reDir);
              handleInput(reDir);
              const inStrip = ['Games', 'Steam', 'ROMs', 'Apps'].includes(activeSectionRef.current)
                && focusAreaRef.current === 'submenu';
              if (inStrip) startAnalogHold(reDir); // new closure, clean state
            }
            // else: truly released — analogHold stays cleared, RAF edge-detect can fire again
          }, 500);
        }
      };

      // Start with initial delay before repeat begins
      analogHold.timer = setTimeout(tick, 380);
    };

    const pollGamepad = () => {
      // Discord panel handles its own full gamepad input when active
      if (window.__arqaDiscordActive) {
        gamepadPollRef.current = requestAnimationFrame(pollGamepad);
        return;
      }
      const gamepads = navigator.getGamepads?.() || [];
      for (let pi = 0; pi < gamepads.length; pi++) {
        const pad = gamepads[pi];
        if (!pad) continue;
        const currentButtons = pad.buttons.map((b) => b.pressed);
        if (!gpHold[pi]) gpHold[pi] = {};

        for (let i = 0; i < currentButtons.length; i++) {
          const wasPressed = lastGamepadButtonState.current[i];
          const isPressed  = currentButtons[i];
          const isHoldKey  = GP_HOLD_BUTTONS[i];

          if (isPressed && !wasPressed) {
            // Fresh press — dispatch immediately
            const keyMap = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape' };
            if (keyMap[i]) window.dispatchEvent(new KeyboardEvent('keydown', { key: keyMap[i], bubbles: true, cancelable: true }));
            // Start hold-repeat timer for left/right in strip submenu
            if (isHoldKey) {
              if (gpHold[pi][i]?.timer) { clearTimeout(gpHold[pi][i].timer); }
              const state = { count: 0, timer: null };
              gpHold[pi][i] = state;
              const tick = () => {
                if (!lastGamepadButtonState.current[i]) return;
                if (['Games', 'Steam', 'ROMs', 'Apps'].includes(activeSectionRef.current) && focusAreaRef.current === 'submenu') {
                  // Direct call — no dispatch so onKeyDown never intercepts it,
                  // preventing keyboard-hold-timer resets and double-firing.
                  inputCooldown.reset(GP_HOLD_BUTTONS[i]);
                  handleInput(GP_HOLD_BUTTONS[i]);
                }
                state.count++;
                const delay = state.count < 4 ? 260 : state.count < 10 ? 130 : state.count < 20 ? 72 : 45;
                state.timer = setTimeout(tick, delay);
              };
              state.timer = setTimeout(tick, 380);
            }
          } else if (!isPressed && wasPressed && isHoldKey) {
            // Released — stop hold repeat
            if (gpHold[pi][i]?.timer) { clearTimeout(gpHold[pi][i].timer); }
            gpHold[pi][i] = null;
          }
        }
        lastGamepadButtonState.current = [...currentButtons];
        if (pad.axes?.length >= 2) {
          const lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
          const lxAbs    = Math.abs(lx);
          const prevLxAbs = Math.abs(lastGamepadAnalogState.current.x);

          // X axis — edge-detect (outer DZ): fire once + start hold-repeat loop (strip only)
          if (lxAbs > AXIS_DZ && prevLxAbs <= AXIS_DZ) {
            const dir = lx > 0 ? 'ArrowRight' : 'ArrowLeft';
            window.dispatchEvent(new KeyboardEvent('keydown', { key: dir, bubbles: true, cancelable: true }));
            const inStrip = ['Games', 'Steam', 'ROMs', 'Apps'].includes(activeSectionRef.current)
              && focusAreaRef.current === 'submenu';
            // Only start the repeat loop when idle (no active hold or 500ms recheck pending)
            if (inStrip && analogHold.dir === null && analogHold.timer === null) {
              startAnalogHold(dir);
            }
          }

          // Y axis — single-fire edge detection
          if (Math.abs(ly) > AXIS_DZ && Math.abs(lastGamepadAnalogState.current.y) <= AXIS_DZ)
            window.dispatchEvent(new KeyboardEvent('keydown', { key: ly > 0 ? 'ArrowDown' : 'ArrowUp', bubbles: true, cancelable: true }));
          lastGamepadAnalogState.current = { x: lx, y: ly };
        }
      }
      gamepadPollRef.current = requestAnimationFrame(pollGamepad);
    };

    const onGamepadConnected = () => {
      if (!gamepadPollRef.current) gamepadPollRef.current = requestAnimationFrame(pollGamepad);
    };
    const onGamepadDisconnected = () => {
      if (gamepadPollRef.current) { cancelAnimationFrame(gamepadPollRef.current); gamepadPollRef.current = null; }
    };

    // Expose a nav callback so the Discord panel (and other overlays) can trigger section exits
    // goHome collapses the Discord panel back to the XMB menu level
    window.__arqaNav = {
      goHome: () => {
        setDiscordEntered(false);
        discordEnteredRef.current = false;
        setFocusArea('menu');
      },
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    // If a gamepad is already connected when the effect mounts, start polling
    if (navigator.getGamepads?.().some(Boolean)) {
      gamepadPollRef.current = requestAnimationFrame(pollGamepad);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      delete window.__arqaNav;
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      if (gamepadPollRef.current) cancelAnimationFrame(gamepadPollRef.current);
      const hs = holdScrollRef.current;
      if (hs.timer) { clearTimeout(hs.timer); hs.timer = null; }
      if (analogHold.timer) { clearTimeout(analogHold.timer); analogHold.timer = null; }
    };
  }, []);

  const chooseBazzite = async () => {
    if (!window.arqaAPI) return;
    const selected = await window.arqaAPI.selectBazziteExecutable();
    if (!selected) return;
    if (selected.error) {
      appendConsole(selected.error);
      return;
    }
    setBazzitePath(selected);
    setStatus('Bazzite ready');
    appendConsole(`Bazzite executable set to: ${selected}`);
  };

  const loadLibrary = async (forcedPath) => {
    if (!window.arqaAPI) return;
    setLibraryLoading(true);
    const result = forcedPath
      ? await window.arqaAPI.rescanLibrary(forcedPath)
      : await window.arqaAPI.selectRomFolder();
    setLibraryLoading(false);

    if (!result) return;
    if (result.error) {
      appendConsole(result.error);
      return;
    }

    setLibrary(result);
    setSubIndex(0);
    appendConsole(`Loaded ${result.roms.length} title(s) from: ${result.folderPath}`);
  };

  const refreshRecentlyPlayed = async () => {
    if (!window.arqaAPI) return;
    const settingsNow = await window.arqaAPI.getSettings();
    setRecentlyPlayed(settingsNow?.recentlyPlayed || []);
  };

  const launchPath = async (romPath, label) => {
    if (!bazzitePathRef.current) {
      appendConsole('Please set the Bazzite executable first.');
      return;
    }
    if (!window.arqaAPI) {
      appendConsole('Launch failed: Arqa system API not available.');
      setStatus('Launch failed');
      setConsoleState('Error');
      return;
    }

    setSelectedRom(label);
    setStatus('Launching...');
    setConsoleState('Starting Bazzite');

    const response = await window.arqaAPI.launchBazzite({
      executablePath: bazzitePathRef.current,
      romPath,
      extraArgs: [],
      useGamescope: useGamescopeRef.current
    });

    if (!response?.success) {
      appendConsole(`Launch failed: ${response?.error || 'Unknown error'}`);
      setStatus('Launch failed');
      setConsoleState('Error');
      return;
    }

    appendConsole(`Launching: ${romPath}${response.usedGamescope ? ' (via gamescope)' : ' (direct — gamescope not used)'}`);
    setStatus('Running');
    setConsoleState('Game running');
    window.arqaAPI.exitFullscreen?.();
    refreshRecentlyPlayed();
  };

  const launchRom = (rom) => {
    if (!libraryRef.current) {
      appendConsole('Please choose a game folder first.');
      return;
    }
    const romPath = `${libraryRef.current.folderPath.replace(/\\/g, '/')}/${rom}`;
    launchPath(romPath, rom);
  };

  // ── Unified item launcher (Games / Steam / ROMs / Apps) ─────────────────────
  const launchItem = async (game) => {
    if (!game) return;
    if (!window.arqaAPI?.launchItem) {
      // Graceful fallback: try legacy rom launch
      if (game.paths?.rom) {
        const romFile = game.metadata?.romFile || game.paths.rom.split('/').pop();
        launchRom(romFile);
      } else {
        appendConsole('Launch API not available (running outside Electron).');
      }
      return;
    }
    setStatus('Launching...');
    setConsoleState(`Starting ${game.title}`);
    appendConsole(`Launching: ${game.title} [${game.behavior?.launchMode || 'unknown'}]`);

    const result = await window.arqaAPI.launchItem({ game });
    if (!result?.success) {
      appendConsole(`Launch failed: ${result?.error || 'Unknown error'}`);
      setStatus('Launch failed');
      setConsoleState('Error');
      return;
    }
    setStatus('Running');
    setConsoleState(`${game.title} running`);
    window.arqaAPI.exitFullscreen?.();
    // Update Discord Rich Presence with the launched game
    window.arqaAPI.discord?.setGamePresence({
      gameName:       game.title,
      platform:       game.metadata?.platform || null,
      launchSource:   game.type   || game.source || null,
      startTimestamp: Math.floor(Date.now() / 1000),
    }).catch(() => {});
  };

  const launchSelected = () => {
    if (selectedRomRef.current) {
      launchRom(selectedRomRef.current);
      return;
    }
    const rom = libraryRef.current?.roms?.[0];
    if (rom) {
      launchRom(rom);
      return;
    }
    loadLibrary();
  };

  const stopGame = async () => {
    if (!window.arqaAPI) return;
    const res = await window.arqaAPI.stopGame();
    if (res?.success) {
      appendConsole('Game stopped by user.');
    } else if (res?.error) {
      appendConsole(res.error);
    }
  };

  const toggleGamescope = async () => {
    const next = !useGamescope;
    setUseGamescope(next);
    await window.arqaAPI?.saveSettings({ useGamescope: next });
    appendConsole(`Gamescope wrapping ${next ? 'enabled' : 'disabled'}.`);
  };

  const clearRecentlyPlayed = async () => {
    setRecentlyPlayed([]);
    await window.arqaAPI?.saveSettings({ recentlyPlayed: [] });
    appendConsole('Recently played list cleared.');
  };

  const removeRecentEntry = async (romPath) => {
    const next = recentlyPlayed.filter((p) => p !== romPath);
    setRecentlyPlayed(next);
    await window.arqaAPI?.saveSettings({ recentlyPlayed: next });
    appendConsole(`Removed from recently played: ${romPath.split('/').pop()}`);
  };

  const confirmOrRun = (action, run) => {
    if (pendingPowerRef.current === action) {
      clearTimeout(pendingPowerTimeout.current);
      setPendingPower(null);
      pendingPowerRef.current = null;
      playSelectSound();
      run();
    } else {
      playSelectSound();
      setPendingPower(action);
      pendingPowerRef.current = action;
      clearTimeout(pendingPowerTimeout.current);
      pendingPowerTimeout.current = setTimeout(() => {
        setPendingPower(null);
        pendingPowerRef.current = null;
      }, 4000);
    }
  };

  const runPowerAction = (action) => {
    appendConsole(`Sending power action: ${action}`);
    window.arqaAPI?.systemPower(action).then((res) => {
      if (res && !res.success) appendConsole(res.error || `Failed to ${action}.`);
    });
  };

  const buildSectionItems = (sectionLabel) => {
    // ── Helper: build strip-compatible items from a game array ──────────────
    const gamesAsItems = (games) => games.map(game => ({
      id:          game.id,
      icon:        game.assets?.icon || PLATFORM_ICONS[game.metadata?.platform] || PLATFORM_ICONS.unknown,
      label:       game.title,
      description: game.metadata?.description || '',
      action:      () => launchItem(game)
    }));

    switch (sectionLabel) {
      // ── Games: locally installed .exe / .AppImage games ───────────────────
      case 'Games': {
        const games = localGames;
        if (!games.length) return [
          { id: 'add-games-dir', icon: ACTION_ICONS.folder, label: 'Add Games Folder', description: 'Pick a directory containing installed games.', action: async () => {
            const result = await window.arqaAPI?.addAppDirectory();
            if (result) {
              const scan = await window.arqaAPI?.scanAppDirectory(result);
              if (scan?.entries?.length) { setLocalGames(prev => [...prev, ...scan.entries]); ContentRegistry.appendToCategory('Games', scan.entries); appendConsole(`Added ${scan.entries.length} game(s) from ${result}`); }
            }
          }},
          { id: 'set-bazzite', icon: ACTION_ICONS.bazzite, label: 'Set Legacy Emulator', description: 'Select the Bazzite/emulator executable for legacy ROMs.', action: chooseBazzite },
          { id: 'status-games', icon: ACTION_ICONS.status, label: 'Status', description: status, disabled: true }
        ];
        return gamesAsItems(games);
      }

      // ── Steam: Steam library entries ──────────────────────────────────────
      case 'Steam': {
        if (steamScanState === 'scanning') {
          return [{ id: 'scanning-steam', icon: ACTION_ICONS.folder, label: 'Scanning Steam\u2026', description: 'Detecting Steam games, please wait.', disabled: true }];
        }
        if (!steamGames.length) return [
          { id: 'scan-steam', icon: ACTION_ICONS.folder, label: 'Scan Steam Library', description: steamScanState === 'error' ? 'Steam not found — set path in Settings.' : 'Find and import your Steam games.', action: async () => {
            setSteamScanState('scanning');
            const result = await window.arqaAPI?.scanSteamLibrary();
            setSteamScanState(result?.error ? 'error' : 'done');
            if (result?.entries?.length) { setSteamGames(result.entries); ContentRegistry.setCategory('Steam', result.entries); appendConsole(`Found ${result.entries.length} Steam game(s).`); }
            else appendConsole(result?.error || 'No Steam games found.');
          }},
          { id: 'steam-status', icon: ACTION_ICONS.status, label: platformInfo?.isWindows ? 'Auto-detecting Steam on Windows' : 'Auto-detecting Steam on Linux', description: 'Steam installation will be found automatically.', disabled: true }
        ];
        return gamesAsItems(steamGames);
      }

      // ── ROMs: multi-directory emulated ROM library ────────────────────────
      case 'ROMs': {
        const loadingRoms = libraryLoading || romScanState === 'scanning';
        if (loadingRoms) {
          return [{ id: 'loading-roms', icon: ACTION_ICONS.folder, label: 'Scanning\u2026', description: 'Loading ROM library, please wait.', disabled: true }];
        }
        const allRoms = romGames.length ? romGames
          : library?.roms?.length ? GameRegistry.fromRomScan(library) : [];

        if (!allRoms.length) return [
          { id: 'add-rom-dir', icon: ACTION_ICONS.folder, label: 'Add ROM Directory', description: 'Pick a folder containing ROM files (supports subdirectories).', action: async () => {
            const result = await window.arqaAPI?.addRomDirectory();
            if (result?.entries?.length) { setRomGames(result.entries); ContentRegistry.setCategory('ROMs', result.entries); appendConsole(`Added ${result.entries.length} ROM(s) from ${result.path}`); }
          }},
          { id: 'legacy-browse', icon: ACTION_ICONS.folder, label: 'Browse ROM Folder (Legacy)', description: 'Single-folder scan compatible with the original library format.', action: () => loadLibrary() },
          { id: 'set-emu', icon: ACTION_ICONS.bazzite, label: 'Set Legacy Emulator', description: 'Configure the Bazzite/emulator path for legacy launches.', action: chooseBazzite }
        ];
        return allRoms.map(game => ({
          id:          game.id,
          icon:        PLATFORM_ICONS[game.metadata?.platform] || PLATFORM_ICONS.unknown,
          label:       game.title,
          description: `${PLATFORM_LABELS[game.metadata?.platform] || 'Unknown'} \u00b7 Enter to launch`,
          action:      () => launchItem(game)
        }));
      }

      // ── Apps: generic applications ────────────────────────────────────────
      case 'Apps': {
        if (!appItems.length) return [
          { id: 'add-app-dir', icon: ACTION_ICONS.folder, label: 'Add Applications Folder', description: 'Pick a directory containing apps or executables.', action: async () => {
            const dirPath = await window.arqaAPI?.addAppDirectory();
            if (dirPath) {
              const scan = await window.arqaAPI?.scanAppDirectory(dirPath);
              if (scan?.entries?.length) { setAppItems(prev => [...prev, ...scan.entries]); ContentRegistry.appendToCategory('Apps', scan.entries); appendConsole(`Added ${scan.entries.length} app(s) from ${dirPath}`); }
              else appendConsole(scan?.error || 'No apps found.');
            }
          }}
        ];
        return gamesAsItems(appItems);
      }

      // ── Settings ──────────────────────────────────────────────────────────
      case 'Settings':
        return [
          { id: 'sep-controls', label: 'Controls', separator: true },
          { id: 'navigation', icon: ACTION_ICONS.navigation, label: 'Navigate', description: '\u2190 \u2192 change section  \u2191 exit strip  1\u20137 jump directly.', disabled: true },
          { id: 'confirm',    icon: ACTION_ICONS.confirm,    label: 'Confirm / Launch', description: 'Enter or \u2715 to select the focused item.', disabled: true },
          { id: 'back',       icon: ACTION_ICONS.back,       label: 'Back', description: 'Esc or \u25cb returns to the menu bar.', disabled: true },
          { id: 'sep-library', label: 'Library', separator: true },
          {
            id: 'gamescope',
            icon: ACTION_ICONS.gamescope,
            label: `Gamescope  ${useGamescope ? '\u2713 On' : '\u2717 Off'}`,
            description: useGamescope ? 'Games launch inside gamescope (Linux recommended).' : 'Games launch directly, without gamescope.',
            action: toggleGamescope
          },
          {
            id: 'rescan',
            icon: ACTION_ICONS.folder,
            label: 'Rescan Legacy Library',
            description: library ? `Re-check \u201c${library.folderPath}\u201d for new titles.` : 'No folder selected yet.',
            action: () => library && loadLibrary(library.folderPath),
            disabled: !library
          },
          {
            id: 'rescan-roms',
            icon: ACTION_ICONS.folder,
            label: 'Rescan ROM Directories',
            description: 'Re-scan all configured ROM directories for new files.',
            action: async () => {
              setRomScanState('scanning');
              const result = await window.arqaAPI?.scanRomDirectories();
              setRomScanState(result?.error ? 'error' : 'done');
              if (result?.entries?.length) { setRomGames(result.entries); ContentRegistry.setCategory('ROMs', result.entries); appendConsole(`Rescanned: ${result.entries.length} ROM(s) found.`); }
              else appendConsole(result?.error || 'No ROMs found.');
            }
          },
          {
            id: 'clear-recent',
            icon: ACTION_ICONS.clear,
            label: 'Clear Recently Played',
            description: recentlyPlayed.length ? `${recentlyPlayed.length} entr${recentlyPlayed.length === 1 ? 'y' : 'ies'} stored.` : 'Nothing to clear.',
            action: clearRecentlyPlayed,
            disabled: !recentlyPlayed.length
          },
          { id: 'sep-emulator', label: 'Emulator', separator: true },
          { id: 'set-bazzite', icon: ACTION_ICONS.bazzite, label: 'Set Legacy Emulator Path', description: bazzitePath || 'Not configured.', action: chooseBazzite },
          { id: 'sep-discord', label: 'Discord', separator: true },
          {
            id: 'discord-status',
            icon: './assets/discord.png',
            label: discordAuthStatus.authenticated
              ? `Signed in as ${discordAuthStatus.user?.globalName || discordAuthStatus.user?.username || 'Discord User'}`
              : 'Not signed in',
            description: discordAuthStatus.authenticated
              ? (discordAuthStatus.connected ? 'Gateway connected \u2022 Real-time events active.' : 'Gateway disconnected \u2014 reconnecting\u2026')
              : 'Sign in to access messaging, friends, and servers.',
            disabled: true
          },
          {
            id: 'discord-signin',
            icon: './assets/discord.png',
            label: discordAuthStatus.authenticated ? 'Sign Out of Discord' : 'Sign In to Discord',
            description: discordAuthStatus.authenticated
              ? 'Revoke access and clear stored credentials.'
              : 'Opens the Discord OAuth2 login window.',
            action: async () => {
              if (discordAuthStatus.authenticated) {
                const r = await window.arqaAPI?.discord?.logout();
                if (r?.success) {
                  setDiscordAuthStatus({ authenticated: false, user: null, connected: false });
                  appendConsole('Signed out of Discord.');
                }
              } else {
                const r = await window.arqaAPI?.discord?.login();
                if (r?.success) {
                  setDiscordAuthStatus({ authenticated: true, user: r.user, connected: false });
                  appendConsole(`Signed in to Discord as ${r.user?.username || 'unknown'}.`);
                } else if (r?.error) {
                  appendConsole(`Discord login failed: ${r.error}`);
                }
              }
            }
          },
          {
            id: 'discord-presence',
            icon: './assets/discord.png',
            label: 'Rich Presence',
            description: 'Automatically shows current game on your Discord profile. Requires Discord desktop app.',
            disabled: true
          },
          {
            id: 'discord-open-settings',
            icon: './assets/discord.png',
            label: 'Discord App Settings',
            description: 'Configure Client ID, Client Secret, and Rich Presence App ID.',
            action: () => {
              playNavigationSound();
              setActiveSection('Discord');
              setFocusArea('menu');
            }
          }
        ];

      // ── Power ─────────────────────────────────────────────────────────────
      case 'Power':
        return ['quit', 'restart', 'sleep', 'shutdown'].map((action) => ({
          id: action,
          icon: POWER_ICONS[action],
          label: pendingPower === action ? 'Press again to confirm' : POWER_LABELS[action],
          description: pendingPower === action
            ? 'This cannot be undone once confirmed.'
            : { quit: 'Closes the Arqa launcher.', restart: 'Reboots the system.', sleep: 'Suspends the system.', shutdown: 'Powers off the system.' }[action],
          armed: pendingPower === action,
          action: () => confirmOrRun(action, () => runPowerAction(action))
        }));

      // ── Discord: rendered via DiscordPanel overlay (see JSX below)
      case 'Discord':
        return [];

      default:
        return [];
    }
  };

  const sectionColors = {
    Games:    { glow: 'rgba(110, 60, 220, 0.16)', wave: 'rgba(123, 77, 255, 0.25)'  },
    Steam:    { glow: 'rgba(26, 159, 255, 0.16)', wave: 'rgba(26, 159, 255, 0.24)'  },
    ROMs:     { glow: 'rgba(155, 107, 255, 0.18)', wave: 'rgba(150, 95, 255, 0.28)' },
    Apps:     { glow: 'rgba(74, 158, 255, 0.14)', wave: 'rgba(74, 158, 255, 0.22)'  },
    Discord:  { glow: 'rgba(88, 101, 242, 0.18)', wave: 'rgba(88, 101, 242, 0.26)'  },
    Settings: { glow: 'rgba(140, 90, 255, 0.15)',  wave: 'rgba(145, 85, 255, 0.24)' },
    Power:    { glow: 'rgba(200, 100, 255, 0.14)', wave: 'rgba(180, 120, 255, 0.22)' }
  };

  const currentColor = sectionColors[activeSection] || sectionColors.Games;

  const navItems = menuItems.map((item) =>
    h('div', {
      key: item.label,
      className: `xmb-title ${activeSection === item.label ? 'active' : ''} ${focusArea === 'menu' && activeSection === item.label ? 'focused' : ''}`,
      onClick: () => {
        playNavigationSound();
        setActiveSection(item.label);
        setFocusArea('menu');
        setSubIndex(0);
      }
    },
      h('div', { className: 'xmb-title-icon-wrap' },
        h('img', {
          className: 'xmb-title-icon',
          src: item.icon,
          alt: item.label,
          onError: (e) => {
            const key = item.icon ? item.icon.replace('./assets/', '').replace('.png', '') : '';
            const fallback = MENU_EMOJI[key] || '🎮';
            e.target.replaceWith(Object.assign(document.createElement('span'), {
              className: 'xmb-title-icon-emoji',
              textContent: fallback
            }));
          }
        })
      ),
      h('p', { className: 'titletext' }, item.label)
    )
  );

  const sectionItems = useMemo(
    () => buildSectionItems(activeSection),
    [activeSection, library, libraryLoading, librarySearch, selectedRom, status, recentlyPlayed, useGamescope, pendingPower, discordAuthStatus]
  );

  useEffect(() => { sectionItemsRef.current = sectionItems; }, [sectionItems]);

  // Section label: name + actionable item count
  const actionableCount = sectionItems.filter((i) => !i.disabled && !i.separator).length;
  const sectionLabel = (libraryLoading || romScanState === 'scanning') && activeSection === 'ROMs'
    ? `${activeSection} \u00b7 Scanning\u2026`
    : actionableCount > 0
      ? `${activeSection} \u00b7 ${actionableCount}`
      : activeSection;

  const submenuItems = sectionItems.length === 0
    ? [h('div', { key: 'empty', className: 'xmb-sub-empty' }, h('span', null, 'No items'))]
    : sectionItems.map((item, index) => {
      // Render separators as grouped section headers
      if (item.separator) {
        return h('div', { key: item.id, className: 'xmb-sub-separator' }, item.label);
      }

      const distance = Math.abs(index - subIndex);
      const scale = Math.max(1 - distance * 0.07, 0.88);
      const opacity = Math.max(1 - distance * 0.18, 0.4);
      const isFocused = subIndex === index;
      const isFlashing = flashItemId === item.id;

      const isImageIcon = item.icon && (item.icon.includes('.png') || item.icon.includes('.jpg') || item.icon.includes('.svg'));
      const iconElement = isImageIcon
        ? h('img', {
            className: 'xmb-sub-icon-img',
            src: item.icon,
            alt: item.label,
            onError: (e) => {
              const fallback = PLATFORM_EMOJI[item.platform] || PLATFORM_EMOJI[item.id] || '\ud83c\udfae';
              e.target.replaceWith(Object.assign(document.createElement('span'), {
                className: 'xmb-sub-icon',
                textContent: fallback
              }));
            }
          })
        : h('span', { className: 'xmb-sub-icon' }, item.icon);

      return h('div', {
        key: item.id,
        className: [
          'xmb-sub-item',
          focusArea === 'submenu' && isFocused ? 'focused' : '',
          item.disabled ? 'disabled' : '',
          item.armed ? 'armed' : '',
          isFlashing ? 'activating' : ''
        ].filter(Boolean).join(' '),
        style: { transform: `scale(${isFocused ? 1.02 : scale})`, opacity: isFocused ? 1 : opacity },
        onClick: () => {
          if (item.disabled) { playInvalidSound(); return; }
          playSelectSound();
          setSubIndex(index);
          setFocusArea('submenu');
          setFlashItemId(item.id);
          setTimeout(() => setFlashItemId(null), 320);
          item.action?.();
        }
      },
        h('div', { className: 'xmb-sub-icon-wrap' }, iconElement),
        h('div', { className: 'xmb-sub-item-content' },
          h('span', { className: 'xmb-sub-label' }, item.label),
          item.description && h('span', { className: 'xmb-sub-desc' }, item.description)
        )
      );
    });

  const timeLabel = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateLabel = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const statusColor = status === 'Running'
    ? '#46e08a'
    : (status === 'Launch failed' || status === 'Error')
      ? '#ff5c7a'
      : status === 'Launching...'
        ? '#ffd166'
        : '#8a5cff';

  const isArmedItem = focusArea === 'submenu' && sectionItems[subIndex]?.armed;

  // ── Library horizontal game strip (XMB horizontal axis) ───────────────────
  const STRIP_SECTIONS_RENDER = ['Games', 'Steam', 'ROMs', 'Apps'];
  const sectionIsLoading =
    (activeSection === 'Steam' && steamScanState === 'scanning') ||
    (activeSection === 'ROMs'  && (libraryLoading || romScanState === 'scanning'));
  const showGameStrip = STRIP_SECTIONS_RENDER.includes(activeSection) && xmbGames.length > 0 && !sectionIsLoading;
  const showDiscordPanel = activeSection === 'Discord' && discordEntered && typeof window.DiscordPanel !== 'undefined';

  const renderGameStrip = () => {
    if (!showGameStrip) return null;

    const games = xmbGames;
    const VISIBLE_RADIUS = 4;
    const CARD_SPACING   = 120; // closer for the 360 overlapping effect
    const start = Math.max(0, subIndex - VISIBLE_RADIUS);
    const end   = Math.min(games.length - 1, subIndex + VISIBLE_RADIUS);
    const searchQuery = librarySearch ? librarySearch.toLowerCase() : '';

    const cards = [];
    for (let i = start; i <= end; i++) {
      const game      = games[i];
      if (!game) continue;
      const offset    = i - subIndex;
      const absOffset = Math.abs(offset);
      const isFocused = offset === 0;
      const isActive  = focusArea === 'submenu' && isFocused;
      const isMatch   = searchQuery ? game.title?.toLowerCase().includes(searchQuery) : true;

      // Xbox 360 RGH fan stack: selected card front-facing, adjacent cards rotated behind
      const rotateY    = offset * -18;
      const scale      = isFocused ? 1.0 : Math.max(0.54, 1 - absOffset * 0.15);
      const opacity    = absOffset > 3 ? 0
        : searchQuery && !isMatch ? 0.18
        : Math.max(0.22, 1 - absOffset * 0.25);
      const translateX = offset * CARD_SPACING;
      const translateY = absOffset * 8;
      const zIndex     = 50 - absOffset * 12;

      const platform   = game.metadata?.platform || 'unknown';
      const coverSrc   = game.assets?.cover || null;
      const iconSrc    = PLATFORM_ICONS[platform] || PLATFORM_ICONS.unknown;
      const accent     = game.ui?.accentColor || '#7b4dff';

      cards.push(
        h('div', {
          key: game.id,
          className: [
            'xmb-game-card',
            isFocused  ? 'focused'  : '',
            isActive   ? 'in-focus' : '',
            searchQuery && !isMatch ? 'dimmed' : ''
          ].filter(Boolean).join(' '),
          style: {
            transform: `translateX(${translateX}px) translateY(${translateY}px) scale(${scale}) rotateY(${rotateY}deg)`,
            opacity,
            zIndex
          },
          onClick: () => {
            if (isFocused && isActive) {
              playSelectSound();
              setFlashItemId(game.id);
              setTimeout(() => setFlashItemId(null), 320);
              launchItem(game);
            } else {
              playNavigationSound();
              setSubIndex(i);
              setFocusArea('submenu');
            }
          }
        },
          h('div', { className: 'xmb-game-card-inner', style: { '--card-accent': accent } },
            coverSrc && h('img', {
              className: 'xmb-game-cover',
              src:       coverSrc,
              alt:       game.title,
              loading:   'lazy',
              decoding:  'async',
              onError:   (e) => { e.target.style.display = 'none'; }
            }),
            h('div', {
              className: `xmb-game-cover-bg${coverSrc ? ' has-cover' : ''}`,
              style: coverSrc ? {} : { background: `linear-gradient(160deg, ${accent}55 0%, #05030c 80%)` }
            },
              !coverSrc && h('img', {
                className: 'xmb-game-platform-icon',
                src:       iconSrc,
                alt:       platform,
                onError:   (e) => {
                  e.target.replaceWith(Object.assign(document.createElement('span'), {
                    className:   'xmb-game-cover-letter',
                    textContent: game.title[0] || '?'
                  }));
                }
              })
            ),
            isActive && h('div', { className: 'xmb-game-card-focus-ring' })
          )
        )
      );
    }

    const focusedGame     = games[subIndex];
    const focusedPlatform = focusedGame?.metadata?.platform || 'unknown';
    const matchCount      = searchQuery ? games.filter(g => g.title?.toLowerCase().includes(searchQuery)).length : 0;

    // Hint bar
    const stripHints = focusArea === 'menu'
      ? h('div', { className: 'xmb-hints' },
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2190'), h('kbd', null, '\u2192'), '\u00a0Navigate'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2193'), '\u00a0Select')
        )
      : h('div', { className: 'xmb-hints' },
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2190'), h('kbd', null, '\u2192'), '\u00a0Browse \u00b7 Hold to scroll fast'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u21b5'), '\u00a0Launch'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, 'A\u2013Z'), '\u00a0Search'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2191'), '\u00a0Back')
        );

    return h('div', { className: `xmb-library-axis${focusArea === 'submenu' ? ' active' : ''}` },
      h('div', { className: 'xmb-sub-section-label xmb-library-label' },
        searchQuery
          ? h('span', null,
              h('span', { className: 'xmb-search-tag' }, '\uD83D\uDD0D\u00a0' + librarySearch),
              '\u00a0',
              h('span', { className: 'xmb-search-count' },
                matchCount === 0 ? 'No matches' : `${matchCount} match${matchCount !== 1 ? 'es' : ''}`
              )
            )
          : sectionLabel
      ),
      h('div', { className: 'xmb-game-strip-wrapper' },
        h('div', { className: 'xmb-game-strip xmb-game-strip-3d' }, ...cards)
      ),
      focusedGame && h('div', { className: 'xmb-game-info', key: focusedGame.id },
        h('h2', { className: 'xmb-game-title' }, focusedGame.title),
        h('div', { className: 'xmb-game-meta' },
          h('span', { className: 'xmb-game-platform' },
            PLATFORM_LABELS[focusedPlatform] || focusedPlatform
          ),
          focusedGame.metadata?.releaseYear && h('span', { className: 'xmb-game-year' },
            '\u00b7 ' + focusedGame.metadata.releaseYear
          )
        ),
        focusedGame.metadata?.description && h('p', { className: 'xmb-game-desc' },
          focusedGame.metadata.description
        ),
        h('div', { className: 'xmb-game-actions' }, stripHints)
      )
    );
  };

  const hintBarContent = focusArea === 'menu'
    ? h('div', { className: 'xmb-hints' },
        h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2190'), h('kbd', null, '\u2192'), '\u00a0Navigate'),
        h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2193'), '\u00a0Enter')
      )
    : isArmedItem
      ? h('div', { className: 'xmb-hints' },
          h('span', { className: 'xmb-hint xmb-hint-warn' }, '\u26a0\u00a0Press again to confirm'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, 'Esc'), '\u00a0Cancel')
        )
      : h('div', { className: 'xmb-hints' },
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u2191'), h('kbd', null, '\u2193'), '\u00a0Browse'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, '\u21b5'), '\u00a0Confirm'),
          h('span', { className: 'xmb-hint' }, h('kbd', null, 'Esc'), '\u00a0Back')
        );

  return h('div', null,
    h('audio', { ref: navSound1Ref, preload: 'auto', style: { display: 'none' } },
      h('source', { src: './assets/nav1.wav', type: 'audio/wav' })
    ),
    h('audio', { ref: navSound2Ref, preload: 'auto', style: { display: 'none' } },
      h('source', { src: './assets/nav2.wav', type: 'audio/wav' })
    ),
    h('audio', { ref: invalidSoundRef, preload: 'auto', style: { display: 'none' } },
      h('source', { src: './assets/invalid.wav', type: 'audio/wav' })
    ),
    h('audio', { ref: selectSoundRef, preload: 'auto', style: { display: 'none' } },
      h('source', { src: './assets/select.wav', type: 'audio/wav' })
    ),
    h('audio', { ref: menuMusicRef, preload: 'auto', loop: true, style: { display: 'none' } },
      h('source', { src: './assets/menumusic1.mp3', type: 'audio/mp3' })
    ),

    booting && h('div', { className: 'startup-overlay' },
      h('img', { className: 'startup-logo', src: './assets/ArqaLogo.png', alt: 'ARQA Logo' }),
      h('div', { className: 'startup-text' }, 'ARQA Launcher')
    ),
    h('div', { className: 'xmb-stage', tabIndex: -1 },

      // ── Dynamic background layer (behind WebGL waves) ──────────────────────
      h('div', { className: 'xmb-bg-layer' },
        h('video', {
          ref:         bgVideoRef,
          className:   `xmb-bg-video${bgState.active && bgState.type === 'video' ? ' visible' : ''}`,
          muted:       true,
          loop:        true,
          playsInline: true,
          'aria-hidden': 'true'
        }),
        h('div', {
          className: `xmb-bg-image${bgState.active && bgState.type === 'image' ? ' visible' : ''}`,
          style: {
            backgroundImage: bgState.source && bgState.type === 'image'
              ? `url("${bgState.source}")`
              : 'none'
          }
        }),
        h('div', {
          className: 'xmb-bg-accent',
          style: {
            background: `radial-gradient(ellipse at 38% 52%, ${bgState.color}1e 0%, transparent 62%)`
          }
        })
      ),

      h('canvas', {
        ref: waveCanvasRef,
        className: 'xmb-webgl-canvas',
        style: { position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', outline: 'none' }
      }),

      // Per-section ambient tint overlays — only the active one is visible (opacity transition)
      ...menuItems.map((item) =>
        h('div', {
          key: `bg-${item.label}`,
          className: `xmb-section-bg xmb-section-bg-${item.label.toLowerCase()} ${activeSection === item.label ? 'active' : ''}`
        })
      ),

      h('div', { className: 'xmb-waves' }),

      h('div', { className: 'hud-top' },
        h('div', { className: 'hud-brand' },
          h('img', { className: 'app-logo', src: './assets/ArqaLogo.png', alt: 'ARQA' }),
          h('span', { className: 'logo' }, 'ARQA')
        ),
        h('div', { className: 'hud-clock' },
          h('span', { className: 'hud-time' }, timeLabel),
          h('span', { className: 'hud-date' }, dateLabel)
        )
      ),

      h('div', { className: 'xmb-row', ref: menuBarRef },
        ...navItems
      ),

      // ── Submenu area: always rendered for menu-anchor ref; hidden when game strip is active ──
      h('div', {
        className: 'xmb-submenu-area',
        ref: submenuAreaRef,
        style: (showGameStrip || showDiscordPanel) ? { opacity: 0, pointerEvents: 'none', userSelect: 'none' } : {}
      },
        (showGameStrip || showDiscordPanel) ? null : h('div', { className: 'xmb-sub-section-label' }, sectionLabel),
        (showGameStrip || showDiscordPanel) ? null : h('div', {
          key: `submenu-${activeSection}`,
          ref: subColumnRef,
          className: `xmb-sub-column${transitionDirRef.current !== 'none' ? ` from-${transitionDirRef.current}` : ''}`
        }, ...submenuItems)
      ),

      // ── Library horizontal game strip (XMB horizontal axis for games) ──────
      renderGameStrip(),

      h('div', { className: 'xmb-hint-bar' }, hintBarContent),
      // (Discord panel overlay and VirtualKeyboard are rendered outside xmb-stage — see below)

      h('div', { className: 'xmb-vignette' }),

      h('div', {
        className: `status-bar ${logExpanded ? 'expanded' : ''}`,
        onClick: () => setLogExpanded((prev) => !prev)
      },
        h('div', { className: 'status-line' },
          h('span', {
            className: `status-dot${status === 'Running' ? ' running' : ''}`,
            style: { background: statusColor, boxShadow: `0 0 10px ${statusColor}` }
          }),
          h('span', null, status),
          h('span', { className: 'status-sep' }, '\u00b7'),
          h('span', null, consoleState),
          h('span', { className: 'status-hint' }, logExpanded ? 'Hide log \u25be' : 'Show log \u25b8')
        ),
        logExpanded && h('pre', { ref: consoleLogRef, className: 'console-log' }, consoleLog.join('\n'))
      )
    ),

    // ── Discord panel overlay ─────────────────────────────────────────────────
    // Rendered OUTSIDE xmb-stage so xmb-stage's `overflow:hidden` + WebGL
    // compositing layer cannot clip or mis-size the fixed child.  Using explicit
    // 100vw/100vh (not inset:0) to give the child a definite pixel height that
    // the Electron <webview> flex layout can resolve against.
    (activeSection === 'Discord' || showDiscordPanel) && typeof window.DiscordPanel !== 'undefined'
      ? h('div', {
          className: 'dc-panel-overlay',
          style: {
            position:      'fixed',
            top:           0,
            left:          0,
            width:         '100vw',
            height:        '100vh',
            zIndex:        999999,
            opacity:       showDiscordPanel ? 1 : 0,
            visibility:    showDiscordPanel ? 'visible' : 'hidden',
            pointerEvents: showDiscordPanel ? 'auto' : 'none',
            transition:    'opacity 0.2s ease',
          },
        },
          h(window.DiscordPanel, { visible: showDiscordPanel })
        )
      : null,

    // ── Virtual keyboard overlay ──────────────────────────────────────────────
    // Rendered OUTSIDE xmb-stage for the same reason as the Discord overlay:
    // xmb-stage's overflow:hidden + WebGL compositor can clip position:fixed
    // children. z-index is above the Discord panel (999999) so the VK always
    // appears on top when triggered from within Discord.
    vkState && h(VirtualKeyboard, {
      prompt:       vkState.prompt       || 'Enter text',
      initialValue: vkState.initialValue || '',
      maxLen:       vkState.maxLen       || 64,
      isPassword:   vkState.isPassword   || false,
      onCommit: (val) => { vkState.onCommit?.(val); setVkState(null); },
      onCancel: ()    => { vkState.onCancel?.();    setVkState(null); },
    })
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(ErrorBoundary, null, h(App)));