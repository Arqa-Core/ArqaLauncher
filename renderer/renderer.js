const { useState, useEffect, useLayoutEffect, useRef, useMemo } = React;
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
  { label: 'Home', icon: './assets/home.png', description: 'Dashboard' },
  { label: 'Library', icon: './assets/folder.png', description: 'Games' },
  { label: 'Launch', icon: './assets/playlists.png', description: 'Run' },
  { label: 'Settings', icon: './assets/settings.png', description: 'Options' },
  { label: 'Power', icon: './assets/power.png', description: 'System' }
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
  home: '🏠', folder: '📁', playlists: '▶️', settings: '⚙️', power: '⏻'
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
  const [activeSection, setActiveSection] = useState('Home');
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

  // Gamepad state tracking
  const lastGamepadButtonState = useRef(Array(16).fill(false));
  const lastGamepadAnalogState = useRef({ x: 0, y: 0 });
  const gamepadPollRef = useRef(null);

  // Cleanup refs
  const pendingPowerTimeout = useRef(null);
  const sectionItemsRef = useRef([]);
  const pendingPowerRef = useRef(null);

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

  // Menu music — starts after the boot splash fades, respects browser autoplay policy
  useEffect(() => {
    if (booting) return;
    const music = menuMusicRef.current;
    if (!music) return;
    music.volume = 0.35;
    const p = music.play();
    if (p) p.catch(() => {}); // silently ignore autoplay block
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
    });
  }, []);

  useEffect(() => {
    const getCurrentIndex = () => menuItems.findIndex((item) => item.label === activeSectionRef.current);

    const jumpToSection = (nextSection, dir = 'none') => {
      transitionDirRef.current = dir;
      // Clear library search when leaving Library
      if (activeSectionRef.current === 'Library' && nextSection !== 'Library') {
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
          if (currentFocus === 'submenu' && subIndexRef.current === 0) {
            setFocusArea('menu');
          } else if (currentFocus === 'submenu') {
            setSubIndex((prev) => clampWrap(prev - 1, itemCount));
          }
          break;
        case 'ArrowDown':
          playNavigationSound();
          if (currentFocus === 'menu' && itemCount > 0) {
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
              jumpToSection('Home');
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
      if (event.repeat) return;

      // Library search mode: intercept printable chars when in Library submenu
      const inLibrarySearch = activeSectionRef.current === 'Library' && focusAreaRef.current === 'submenu';
      if (inLibrarySearch) {
        if (event.key === 'Backspace') {
          setLibrarySearch((prev) => {
            const next = prev.slice(0, -1);
            librarySearchRef.current = next;
            return next;
          });
          clearTimeout(librarySearchTimeoutRef.current);
          librarySearchTimeoutRef.current = setTimeout(() => {
            setLibrarySearch('');
            librarySearchRef.current = '';
          }, 2000);
          event.preventDefault();
          return;
        }
        if (event.key.length === 1 && /^[a-zA-Z0-9]$/.test(event.key)) {
          const next = librarySearchRef.current + event.key;
          librarySearchRef.current = next;
          setLibrarySearch(next);
          clearTimeout(librarySearchTimeoutRef.current);
          librarySearchTimeoutRef.current = setTimeout(() => {
            setLibrarySearch('');
            librarySearchRef.current = '';
          }, 2000);
          return;
        }
      }

      const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
      const sectionKeys = ['1', '2', '3', '4', '5'];
      if (!navKeys.includes(event.key) && !sectionKeys.includes(event.key)) return;
      if (navKeys.includes(event.key)) event.preventDefault();
      handleInput(event.key);
    };

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads?.() || [];
      for (const pad of gamepads) {
        if (!pad) continue;
        const currentButtons = pad.buttons.map((b) => b.pressed);
        for (let i = 0; i < currentButtons.length; i++) {
          if (currentButtons[i] && !lastGamepadButtonState.current[i]) {
            switch (i) {
              case 12: handleInput('ArrowUp'); break;
              case 13: handleInput('ArrowDown'); break;
              case 14: handleInput('ArrowLeft'); break;
              case 15: handleInput('ArrowRight'); break;
              case 0:  handleInput('Enter'); break;
              case 1:  handleInput('Escape'); break;
            }
          }
        }
        lastGamepadButtonState.current = [...currentButtons];
        if (pad.axes?.length >= 2) {
          const lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
          const DZ = 0.65;
          if (Math.abs(lx) > DZ && Math.abs(lastGamepadAnalogState.current.x) <= DZ)
            handleInput(lx > 0 ? 'ArrowRight' : 'ArrowLeft');
          if (Math.abs(ly) > DZ && Math.abs(lastGamepadAnalogState.current.y) <= DZ)
            handleInput(ly > 0 ? 'ArrowDown' : 'ArrowUp');
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

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    // If a gamepad is already connected when the effect mounts, start polling
    if (navigator.getGamepads?.().some(Boolean)) {
      gamepadPollRef.current = requestAnimationFrame(pollGamepad);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      if (gamepadPollRef.current) cancelAnimationFrame(gamepadPollRef.current);
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
    switch (sectionLabel) {
      case 'Home': {
        const items = [
          { id: 'set-bazzite', icon: ACTION_ICONS.bazzite, label: 'Set Bazzite', description: 'Select the emulator executable on disk.', action: chooseBazzite },
          { id: 'browse-library', icon: ACTION_ICONS.folder, label: 'Browse Library', description: 'Choose the folder that holds your ROMs.', action: () => loadLibrary() },
          { id: 'selected-rom', icon: ACTION_ICONS.rom, label: 'Selected ROM', description: selectedRom ? formatRomName(selectedRom) : 'No ROM selected yet.', disabled: true },
          { id: 'status', icon: ACTION_ICONS.status, label: 'Status', description: status, disabled: true }
        ];
        recentlyPlayed.slice(0, 3).forEach((romPath, index) => {
          const raw = romPath.split('/').pop();
          const name = formatRomName(raw);
          items.push({
            id: `recent-${index}`,
            icon: ACTION_ICONS.recent,
            label: name,
            description: 'Recently played \u2014 press Enter to relaunch.',
            action: () => launchPath(romPath, raw)
          });
          items.push({
            id: `recent-remove-${index}`,
            icon: ACTION_ICONS.remove,
            label: `Remove \u201c${name}\u201d`,
            description: 'Remove this entry from recently played.',
            action: () => removeRecentEntry(romPath)
          });
        });
        return items;
      }
      case 'Library': {
        if (libraryLoading) {
          return [{ id: 'loading', icon: ACTION_ICONS.folder, label: 'Scanning\u2026', description: 'Loading your game library, please wait.', disabled: true }];
        }
        if (!library?.roms?.length) {
          return [{ id: 'empty', icon: ACTION_ICONS.folder, label: 'Library Empty', description: 'Pick a folder to load games.', disabled: true }];
        }
        return library.roms.map((rom) => {
          const platform = library.platforms?.[rom] || 'unknown';
          return {
            id: rom,
            icon: PLATFORM_ICONS[platform] || PLATFORM_ICONS.unknown,
            label: formatRomName(rom),
            description: `${PLATFORM_LABELS[platform] || 'Unknown system'} \u00b7 \u2715 / Enter to launch`,
            action: () => launchRom(rom)
          };
        });
      }
      case 'Launch': {
        const items = [];
        if (status === 'Running') {
          items.push({ id: 'stop', icon: ACTION_ICONS.stop, label: 'Stop Game', description: 'Terminate the currently running game.', action: stopGame });
        }
        items.push(
          { id: 'launch', icon: ACTION_ICONS.launch, label: 'Launch Selected', description: selectedRom ? `Resume \u201c${formatRomName(selectedRom)}\u201d with Bazzite.` : 'No game selected yet.', action: launchSelected, disabled: !selectedRom && !library?.roms?.length },
          { id: 'select-bazzite', icon: ACTION_ICONS.bazzite, label: 'Select Bazzite', description: 'Choose the emulator executable.', action: chooseBazzite },
          { id: 'pick-folder', icon: ACTION_ICONS.folder, label: 'Pick Folder', description: 'Load your game library from disk.', action: () => loadLibrary() }
        );
        return items;
      }
      case 'Settings':
        return [
          // \u2500\u2500 Controls (informational hints) \u2500\u2500
          { id: 'sep-controls', label: 'Controls', separator: true },
          { id: 'navigation', icon: ACTION_ICONS.navigation, label: 'Navigate', description: '\u2190 \u2192 change section \u00b7 \u2191 \u2193 browse items \u00b7 1\u20135 jump directly.', disabled: true },
          { id: 'confirm', icon: ACTION_ICONS.confirm, label: 'Confirm / Launch', description: 'Enter or \u2715 to select the focused item.', disabled: true },
          { id: 'back', icon: ACTION_ICONS.back, label: 'Back', description: 'Esc or \u25cb to return to the menu bar.', disabled: true },
          // \u2500\u2500 Options (actionable) \u2500\u2500
          { id: 'sep-options', label: 'Options', separator: true },
          {
            id: 'gamescope',
            icon: ACTION_ICONS.gamescope,
            label: `Gamescope  ${useGamescope ? '\u2713 On' : '\u2717 Off'}`,
            description: useGamescope
              ? 'Games launch inside a gamescope session (recommended on Arqa).'
              : 'Games launch directly, without gamescope.',
            action: toggleGamescope
          },
          {
            id: 'rescan',
            icon: ACTION_ICONS.folder,
            label: 'Rescan Library',
            description: library ? `Re-check \u201c${library.folderPath}\u201d for new titles.` : 'No folder selected yet.',
            action: () => library && loadLibrary(library.folderPath),
            disabled: !library
          },
          {
            id: 'clear-recent',
            icon: ACTION_ICONS.clear,
            label: 'Clear Recently Played',
            description: recentlyPlayed.length ? `${recentlyPlayed.length} entr${recentlyPlayed.length === 1 ? 'y' : 'ies'} stored.` : 'Nothing to clear.',
            action: clearRecentlyPlayed,
            disabled: !recentlyPlayed.length
          }
        ];
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
      default:
        return [];
    }
  };

  const sectionColors = {
    Home: { glow: 'rgba(126, 79, 255, 0.16)', wave: 'rgba(138, 84, 255, 0.25)' },
    Library: { glow: 'rgba(155, 107, 255, 0.18)', wave: 'rgba(150, 95, 255, 0.28)' },
    Launch: { glow: 'rgba(110, 60, 230, 0.16)', wave: 'rgba(123, 77, 255, 0.25)' },
    Settings: { glow: 'rgba(140, 90, 255, 0.15)', wave: 'rgba(145, 85, 255, 0.24)' },
    Power: { glow: 'rgba(200, 100, 255, 0.14)', wave: 'rgba(180, 120, 255, 0.22)' }
  };
  
  const currentColor = sectionColors[activeSection] || sectionColors.Home;

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
    [activeSection, library, libraryLoading, librarySearch, selectedRom, status, recentlyPlayed, useGamescope, pendingPower]
  );

  useEffect(() => { sectionItemsRef.current = sectionItems; }, [sectionItems]);

  // Section label: name + actionable item count
  const actionableCount = sectionItems.filter((i) => !i.disabled && !i.separator).length;
  const sectionLabel = libraryLoading && activeSection === 'Library'
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
      h('canvas', {
        ref: waveCanvasRef,
        className: 'xmb-webgl-canvas',
        style: { position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', outline: 'none' }
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

      h('div', { className: 'xmb-submenu-area', ref: submenuAreaRef },
        h('div', { className: 'xmb-sub-section-label' }, sectionLabel),
        h('div', {
          key: `submenu-${activeSection}`,
          className: `xmb-sub-column${transitionDirRef.current !== 'none' ? ` from-${transitionDirRef.current}` : ''}`
        },
          ...submenuItems
        )
      ),

      h('div', { className: 'xmb-hint-bar' }, hintBarContent),

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
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(ErrorBoundary, null, h(App)));