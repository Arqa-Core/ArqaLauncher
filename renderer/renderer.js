const { useState, useEffect, useRef } = React;
const h = React.createElement;

const menuItems = [
  { label: 'Home', icon: './assets/home.png', description: 'Dashboard' },
  { label: 'Library', icon: './assets/folder.png', description: 'Games' },
  { label: 'Launch', icon: './assets/playlists.png', description: 'Run' },
  { label: 'Settings', icon: './assets/settings.png', description: 'Options' }
];

const App = () => {
  const [activeSection, setActiveSection] = useState('Home');
  const [focusArea, setFocusArea] = useState('menu');
  const [subIndex, setSubIndex] = useState(0);
  const [focusedGameIndex, setFocusedGameIndex] = useState(0);
  const [bazzitePath, setBazzitePath] = useState(null);
  const [library, setLibrary] = useState(null);
  const [selectedRom, setSelectedRom] = useState(null);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState('Idle');
  const [consoleLog, setConsoleLog] = useState(['Ready.']);
  const [consoleState, setConsoleState] = useState('Awaiting launch');
  const [logExpanded, setLogExpanded] = useState(false);
  const [clock, setClock] = useState(new Date());

  const activeSectionRef = useRef(activeSection);
  const focusAreaRef = useRef(focusArea);
  const subIndexRef = useRef(subIndex);
  const focusedGameRef = useRef(focusedGameIndex);
  const libraryRef = useRef(library);
  const selectedRomRef = useRef(selectedRom);
  const bazzitePathRef = useRef(bazzitePath);
  const menuMusicRef = useRef(null);
  const navSoundRef = useRef(null);
  const startupSoundRef = useRef(null);
  const menuBarRef = useRef(null);
  const lastGamepadState = useRef([]);
  const gamepadRAF = useRef(null);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    focusAreaRef.current = focusArea;
  }, [focusArea]);

  useEffect(() => {
    subIndexRef.current = subIndex;
  }, [subIndex]);

  // PS3-style clock, top right of the XMB
  useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!window.Audio) {
      return;
    }

    navSoundRef.current = new Audio('../Assets/nav.mp3');
    navSoundRef.current.volume = 0.16;

    menuMusicRef.current = new Audio('../Assets/menumusic1.mp3');
    menuMusicRef.current.loop = true;
    menuMusicRef.current.volume = 0.12;

    startupSoundRef.current = new Audio('../playstation-3-xmb-main/audio/startup.mp3');
    startupSoundRef.current.volume = 0.18;
    startupSoundRef.current.play().catch(() => {});

    const startMenuAudio = () => {
      if (menuMusicRef.current && menuMusicRef.current.paused) {
        menuMusicRef.current.play().catch(() => {});
      }
      window.removeEventListener('click', startMenuAudio);
      window.removeEventListener('keydown', startMenuAudio);
    };

    window.addEventListener('click', startMenuAudio);
    window.addEventListener('keydown', startMenuAudio);

    return () => {
      window.removeEventListener('click', startMenuAudio);
      window.removeEventListener('keydown', startMenuAudio);
      menuMusicRef.current?.pause();
      menuMusicRef.current = null;
      navSoundRef.current = null;
      startupSoundRef.current = null;
    };
  }, []);

  const playAudioClip = (audioRef, fallbackSrc, volume) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.volume = volume;
      audio.play().catch(() => {});
      return;
    }

    if (window.Audio && fallbackSrc) {
      const clip = new Audio(fallbackSrc);
      clip.volume = volume;
      clip.play().catch(() => {});
    }
  };

  const playNavigationSound = () => playAudioClip(navSoundRef, '../Assets/nav.mp3', 0.16);
  const playSelectSound = () => playAudioClip(navSoundRef, '../Assets/nav.mp3', 0.20);
  const playBackSound = () => playAudioClip(navSoundRef, '../Assets/nav.mp3', 0.12);

  useEffect(() => {
    focusedGameRef.current = focusedGameIndex;
  }, [focusedGameIndex]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    selectedRomRef.current = selectedRom;
  }, [selectedRom]);

  useEffect(() => {
    bazzitePathRef.current = bazzitePath;
  }, [bazzitePath]);

  useEffect(() => {
    if (!menuBarRef.current) return;
    const activeItem = menuBarRef.current.querySelector('.xmb-title.active');
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeSection]);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!window.bazziteAPI) {
      appendConsole('Warning: Bazzite API not available.');
      return;
    }

    appendConsole('Bazzite API is available.');

    window.bazziteAPI.onOutput((data) => {
      appendConsole(data.toString().trim());
    });

    window.bazziteAPI.onExit((code) => {
      appendConsole(`Bazzite exited with code ${code}`);
      setStatus('Idle');
      setConsoleState('Awaiting launch');
    });
  }, []);

  useEffect(() => {
    const getCurrentIndex = () => menuItems.findIndex((item) => item.label === activeSectionRef.current);

    const handleInput = (input) => {
      const currentFocus = focusAreaRef.current;
      const currentSection = activeSectionRef.current;
      const currentItems = buildSectionItems({ label: currentSection });
      const itemCount = currentItems.length;
      const gameCount = libraryRef.current?.roms?.length || 0;

      switch (input) {
        case 'ArrowLeft':
          playNavigationSound();
          if (currentFocus === 'menu') {
            const currentIndex = getCurrentIndex();
            const nextIndex = (currentIndex + menuItems.length - 1) % menuItems.length;
            setActiveSection(menuItems[nextIndex].label);
            setFocusArea('menu');
            setSubIndex(0);
          } else if (itemCount > 0) {
            setSubIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'ArrowRight':
          playNavigationSound();
          if (currentFocus === 'menu') {
            const currentIndex = getCurrentIndex();
            const nextIndex = (currentIndex + 1) % menuItems.length;
            setActiveSection(menuItems[nextIndex].label);
            setFocusArea('menu');
            setSubIndex(0);
          } else if (itemCount > 0) {
            setSubIndex((prev) => Math.min(prev + 1, itemCount - 1));
          }
          break;
        case 'ArrowUp':
          playNavigationSound();
          if (currentFocus === 'submenu' && subIndexRef.current === 0) {
            setFocusArea('menu');
          } else if (currentFocus === 'submenu') {
            setSubIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'ArrowDown':
          playNavigationSound();
          if (currentFocus === 'menu' && itemCount > 0) {
            setFocusArea('submenu');
          } else if (currentFocus === 'submenu' && itemCount > 0) {
            setSubIndex((prev) => Math.min(prev + 1, itemCount - 1));
          }
          break;
        case 'Enter':
          if (currentFocus === 'submenu') {
            const item = currentItems[subIndexRef.current];
            if (item?.action && !item.disabled) {
              playSelectSound();
              item.action();
            }
          }
          break;
        case 'Back':
        case 'Escape':
          playBackSound();
          if (focusAreaRef.current === 'submenu') {
            setFocusArea('menu');
          } else {
            setActiveSection('Home');
            setFocusArea('menu');
          }
          break;
      }
    };

    const onKeyDown = (event) => {
      if (event.repeat) return;
      handleInput(event.key);
    };

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads?.() || [];
      for (const pad of gamepads) {
        if (!pad) continue;
        const pressed = pad.buttons.map((button) => button.pressed);
        pressed.forEach((isPressed, index) => {
          if (isPressed && !lastGamepadState.current[index]) {
            switch (index) {
              case 12:
                handleInput('ArrowUp');
                break;
              case 13:
                handleInput('ArrowDown');
                break;
              case 14:
                handleInput('ArrowLeft');
                break;
              case 15:
                handleInput('ArrowRight');
                break;
              case 0:
                handleInput('Enter');
                break;
              case 1:
                handleInput('Escape');
                break;
            }
          }
        });
        lastGamepadState.current = pressed;
      }
      gamepadRAF.current = requestAnimationFrame(pollGamepad);
    };

    window.addEventListener('keydown', onKeyDown);
    const disableMouse = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('pointerdown', disableMouse, true);
    window.addEventListener('mousedown', disableMouse, true);
    window.addEventListener('contextmenu', disableMouse, true);

    gamepadRAF.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', disableMouse, true);
      window.removeEventListener('mousedown', disableMouse, true);
      window.removeEventListener('contextmenu', disableMouse, true);
      if (gamepadRAF.current) {
        cancelAnimationFrame(gamepadRAF.current);
      }
    };
  }, []);

  const appendConsole = (line) => {
    setConsoleLog((current) => [...current, line]);
  };

  const chooseBazzite = async () => {
    if (!window.bazziteAPI) return;
    const selected = await window.bazziteAPI.selectBazziteExecutable();
    if (selected) {
      setBazzitePath(selected);
      setStatus('Bazzite ready');
      appendConsole(`Bazzite executable set to: ${selected}`);
    }
  };

  const chooseFolder = async () => {
    if (!window.bazziteAPI) return;
    const result = await window.bazziteAPI.selectRomFolder();
    if (!result) {
      return;
    }
    setLibrary(result);
    setSubIndex(0);
    setFocusedGameIndex(0);
    appendConsole(`Loaded library from: ${result.folderPath}`);
  };

  const launchRom = async (rom) => {
    if (!bazzitePath) {
      appendConsole('Please set the Bazzite executable first.');
      return;
    }

    if (!library) {
      appendConsole('Please choose a game folder first.');
      return;
    }

    const romPath = `${library.folderPath.replace(/\\/g, '/')}/${rom}`;
    setSelectedRom(rom);
    setStatus('Launching...');
    setConsoleState('Starting Bazzite');

    if (!window.bazziteAPI) {
      appendConsole('Launch failed: Bazzite API not available.');
      setStatus('Launch failed');
      setConsoleState('Error');
      return;
    }

    const response = await window.bazziteAPI.launchBazzite({
      executablePath: bazzitePath,
      romPath,
      extraArgs: []
    });

    if (!response.success) {
      appendConsole(`Launch failed: ${response.error}`);
      setStatus('Launch failed');
      setConsoleState('Error');
      return;
    }

    if (window.bazziteAPI?.exitFullscreen) {
      window.bazziteAPI.exitFullscreen();
    }

    appendConsole(`Launching ROM: ${romPath}`);
    setStatus('Running');
  };

  const launchSelected = () => {
    if (selectedRom) {
      launchRom(selectedRom);
      return;
    }

    const rom = library?.roms?.[0];
    if (rom) {
      launchRom(rom);
      return;
    }

    chooseFolder();
  };

  const buildSectionItems = (section) => {
    switch (section.label) {
      case 'Home':
        return [
          { id: 'set-bazzite', icon: '🧩', label: 'Set Bazzite', description: 'Select the emulator executable on disk.', action: chooseBazzite },
          { id: 'browse-library', icon: '📁', label: 'Browse Library', description: 'Choose the folder that holds your ROMs.', action: chooseFolder },
          { id: 'selected-rom', icon: '🎯', label: 'Selected ROM', description: selectedRom || 'No ROM selected yet.', disabled: true },
          { id: 'status', icon: '⚡', label: 'Status', description: status, disabled: true }
        ];
      case 'Library':
        if (!library?.roms?.length) {
          return [{ id: 'empty', icon: '📂', label: 'Library Empty', description: 'Pick a folder to load games.', disabled: true }];
        }
        return library.roms.map((rom) => ({
          id: rom,
          icon: '🎮',
          label: rom,
          description: 'Press ✕ / Enter to launch this title.',
          action: () => launchRom(rom)
        }));
      case 'Launch':
        return [
          { id: 'launch', icon: '▶️', label: 'Launch Selected', description: selectedRom ? `Resume "${selectedRom}" with Bazzite.` : 'No game selected yet.', action: launchSelected, disabled: !selectedRom && !library?.roms?.length },
          { id: 'select-bazzite', icon: '🧩', label: 'Select Bazzite', description: 'Choose the emulator executable.', action: chooseBazzite },
          { id: 'pick-folder', icon: '📁', label: 'Pick Folder', description: 'Load your game library from disk.', action: chooseFolder }
        ];
      case 'Settings':
        return [
          { id: 'navigation', icon: '🕹️', label: 'Navigation', description: 'Use arrow keys or the D-pad to move.', disabled: true },
          { id: 'confirm', icon: '✅', label: 'Confirm', description: 'Press Enter or ✕ to select.', disabled: true },
          { id: 'back', icon: '↩️', label: 'Back', description: 'Press Escape or ◯ to return.', disabled: true },
          { id: 'fullscreen', icon: '🖥️', label: 'Fullscreen', description: 'Launcher stays fullscreen until a game runs.', disabled: true }
        ];
      default:
        return [];
    }
  };

  const activeIndex = Math.max(menuItems.findIndex((item) => item.label === activeSection), 0);
  const columnLeftPercent = ((activeIndex + 0.5) / menuItems.length) * 100;

  const navItems = menuItems.map((item, index) =>
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
        h('img', { className: 'xmb-title-icon', src: item.icon, alt: item.label })
      ),
      h('p', { className: 'titletext' }, item.label)
    )
  );

  const sectionItems = buildSectionItems(menuItems.find((item) => item.label === activeSection) || menuItems[0]);
  const previewItem = sectionItems[subIndex] || sectionItems[0];

  const submenuItems = sectionItems.map((item, index) => {
    const distance = Math.abs(index - subIndex);
    const scale = Math.max(1 - distance * 0.1, 0.8);
    const opacity = Math.max(1 - distance * 0.22, 0.4);
    const isFocused = subIndex === index;

    return h('div', {
      key: item.id,
      className: `xmb-sub-item ${focusArea === 'submenu' && isFocused ? 'focused' : ''} ${item.disabled ? 'disabled' : ''}`,
      style: { transform: `scale(${isFocused ? 1.08 : scale})`, opacity: isFocused ? 1 : opacity },
      onClick: () => {
        if (item.disabled) return;
        playSelectSound();
        setSubIndex(index);
        setFocusArea('submenu');
        item.action?.();
      }
    },
      h('span', { className: 'xmb-sub-icon' }, item.icon),
      h('span', { className: 'xmb-sub-label' }, item.label)
    );
  });

  const timeLabel = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateLabel = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return h('div', null,
    booting && h('div', { className: 'startup-overlay' },
      h('img', { className: 'startup-logo', src: './assets/ArqaLogo.png', alt: 'ARQA Logo' }),
      h('div', { className: 'startup-text' }, 'ARQA Launcher')
    ),
    h('div', { className: 'xmb-stage' },
      h('div', { className: 'xmb-waves' },
        h('div', { className: 'wave wave-1' }),
        h('div', { className: 'wave wave-2' }),
        h('div', { className: 'wave wave-3' }),
        h('div', { className: 'wave-glow' })
      ),

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

      h('div', {
        className: 'xmb-submenu-area',
        style: { left: `${columnLeftPercent}%` }
      },
        h('div', { className: 'xmb-sub-column' },
          ...submenuItems
        )
      ),

      h('div', { className: 'xmb-preview' },
        h('div', { className: 'preview-icon' }, previewItem?.icon || '🎮'),
        h('div', { className: 'preview-text' },
          h('p', { className: 'preview-eyebrow' }, activeSection),
          h('h2', { className: 'preview-title' }, previewItem?.label || menuItems[activeIndex]?.description),
          h('p', { className: 'preview-desc' }, previewItem?.description || menuItems[activeIndex]?.description)
        )
      ),

      h('div', {
        className: `status-bar ${logExpanded ? 'expanded' : ''}`,
        onClick: () => setLogExpanded((prev) => !prev)
      },
        h('div', { className: 'status-line' },
          h('span', { className: 'status-dot' }),
          h('span', null, status),
          h('span', { className: 'status-sep' }, '·'),
          h('span', null, consoleState),
          h('span', { className: 'status-hint' }, logExpanded ? 'Hide log ▾' : 'Show log ▸')
        ),
        logExpanded && h('pre', { className: 'console-log' }, consoleLog.join('\n'))
      )
    )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));