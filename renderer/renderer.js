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
          setFocusArea('menu');
          setSubIndex(0);
          break;
        case 'ArrowDown':
          playNavigationSound();
          if (itemCount > 0) {
            setFocusArea('submenu');
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
          setActiveSection('Home');
          setFocusArea('menu');
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

  const currentGames = library?.roms || [];
  const gameGridChildren = currentGames.length === 0
    ? [
        h('div', { className: 'placeholder-card' },
          h('p', null, 'No compatible game files found. Pick a folder with ISO/PBP/CUE/ELF.')
        )
      ]
    : currentGames.map((rom, index) =>
        h('div', {
          key: rom,
          className: `game-card ${focusArea === 'library' && focusedGameIndex === index ? 'focused' : ''}`,
          onClick: () => {
            setFocusedGameIndex(index);
            launchRom(rom);
          }
        },
          h('h3', null, rom),
          h('p', null, 'Click to launch with Bazzite'),
          h('span', { className: 'launch-prompt' }, '▶')
        )
      );

  const buildSectionItems = (section) => {
    switch (section.label) {
      case 'Home':
        return [
          { id: 'set-bazzite', icon: '🧩', label: 'Set Bazzite', description: 'Select the emulator exe', action: chooseBazzite },
          { id: 'browse-library', icon: '📁', label: 'Browse Library', description: 'Load your game folder', action: chooseFolder },
          { id: 'selected-rom', icon: '🎯', label: 'Selected ROM', description: selectedRom || 'None', disabled: true },
          { id: 'status', icon: '⚡', label: 'Status', description: status, disabled: true }
        ];
      case 'Library':
        if (!library?.roms?.length) {
          return [{ id: 'empty', icon: '📂', label: 'Library Empty', description: 'Pick a folder to load games', disabled: true }];
        }
        return library.roms.map((rom) => ({
          id: rom,
          icon: '🎮',
          label: rom,
          description: 'Press A / Enter to launch',
          action: () => launchRom(rom)
        }));
      case 'Launch':
        return [
          { id: 'launch', icon: '▶️', label: 'Launch Selected', description: selectedRom || 'No game selected', action: launchSelected, disabled: !selectedRom && !library?.roms?.length },
          { id: 'select-bazzite', icon: '🧩', label: 'Select Bazzite', description: 'Choose emulator executable', action: chooseBazzite },
          { id: 'pick-folder', icon: '📁', label: 'Pick Folder', description: 'Load your game library', action: chooseFolder }
        ];
      case 'Settings':
        return [
          { id: 'navigation', icon: '🕹️', label: 'Navigation', description: 'Use arrows or D-pad', disabled: true },
          { id: 'confirm', icon: '✅', label: 'Confirm', description: 'Press Enter or A', disabled: true },
          { id: 'back', icon: '↩️', label: 'Back', description: 'Press Escape or B', disabled: true },
          { id: 'fullscreen', icon: '🖥️', label: 'Fullscreen', description: 'Launcher stays fullscreen until launch', disabled: true }
        ];
      default:
        return [];
    }
  };

  const sectionContent = () => {
    switch (activeSection) {
      case 'Library':
        return h('div', null,
          h('section', { className: 'card library-panel' },
            h('div', { className: 'panel-header' },
              h('div', null,
                h('h2', null, 'Game Library'),
                h('p', { className: 'panel-subtitle' }, library ? `${currentGames.length} titles available` : 'Pick a folder to populate your library')
              ),
              h('button', { className: 'secondary-button', onClick: chooseFolder }, 'Reload')
            ),
            h('div', { className: `game-grid ${currentGames.length === 0 ? 'empty' : ''}` },
              ...gameGridChildren
            )
          )
        );
      case 'Launch':
        return h('section', { className: 'card launch-panel' },
          h('div', { className: 'panel-header' },
            h('div', null,
              h('h2', null, 'Quick Launch'),
              h('p', { className: 'panel-subtitle' }, 'Use controller or keyboard to fire up a game fast')
            )
          ),
          h('div', { className: 'launch-body' },
            h('div', { className: 'launch-info' },
              h('div', null, h('span', null, 'Selected ROM')),
              h('strong', null, selectedRom || 'No ROM selected'),
              h('div', null, h('span', null, 'Bazzite EXE')),
              h('strong', null, bazzitePath || 'Not set')
            ),
            h('div', { className: 'launch-actions' },
              h('button', { className: 'action-button', onClick: chooseBazzite }, 'Select Bazzite'),
              h('button', { className: 'action-button', onClick: chooseFolder }, 'Pick Folder'),
              h('button', { className: 'secondary-button', onClick: launchSelected }, 'Launch')
            )
          )
        );
      case 'Settings':
        return h('section', { className: 'card settings-panel' },
          h('div', { className: 'panel-header' },
            h('div', null,
              h('h2', null, 'Settings'),
              h('p', { className: 'panel-subtitle' }, 'Controller and display preferences')
            )
          ),
          h('div', { className: 'settings-grid' },
            h('div', { className: 'settings-item' },
              h('h3', null, 'Navigation'),
              h('p', null, 'Use arrow keys or D-pad to move between categories and items.')
            ),
            h('div', { className: 'settings-item' },
              h('h3', null, 'Select / Back'),
              h('p', null, 'Press Enter or A to confirm, Escape or B to return home.')
            ),
            h('div', { className: 'settings-item' },
              h('h3', null, 'Focus'),
              h('p', null, 'Selected items are highlighted to help navigation feel like XMB.')
            )
          )
        );
      default:
        return h('div', null,
          h('section', { className: 'hero card' },
            h('div', { className: 'hero-copy' },
              h('h1', null, 'PlayStation XMB Style'),
              h('p', null, 'Modern frontend for Bazzite with a dark violet XMB-inspired dashboard, quick game access, and responsive controls.')
            ),
            h('div', { className: 'hero-controls' },
              h('button', { className: 'action-button', onClick: chooseBazzite }, 'Set Bazzite EXE'),
              h('button', { className: 'action-button', onClick: chooseFolder }, 'Browse Game Folder')
            )
          )
        );
    }
  };

  const navItems = menuItems.map((item) =>
    h('div', {
      key: item.label,
      className: `xmb-title ${activeSection === item.label ? 'active' : ''} ${focusArea === 'menu' && activeSection === item.label ? 'focused' : ''}`,
      onClick: () => {
        activateAudio();
        playNavigationSound();
        setActiveSection(item.label);
        setFocusArea('menu');
        setSubIndex(0);
      }
    },
      h('img', { className: 'xmb-title-icon', src: item.icon, alt: item.label }),
      h('p', { className: 'titletext' }, item.label)
    )
  );

  const sectionItems = buildSectionItems(menuItems.find((item) => item.label === activeSection) || menuItems[0]);

  const submenuItems = sectionItems.map((item, index) =>
    h('div', {
      key: item.id,
      className: `submenu ${focusArea === 'submenu' && subIndex === index ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`,
      onClick: () => {
        if (item.disabled) return;
        activateAudio();
        playSelectSound();
        setSubIndex(index);
        setFocusArea('submenu');
        item.action?.();
      }
    },
      h('div', { className: 'submenu-icon' }, item.icon),
      h('div', { className: 'submenu-body' },
        h('p', { className: 'submenu-title' }, item.label),
        h('p', { className: 'submenu-description' }, item.description)
      )
    )
  );

  return h('div', null,
    booting && h('div', { className: 'startup-overlay' },
      h('img', { className: 'startup-logo', src: './assets/ArqaLogo.png', alt: 'ARQA Logo' }),
      h('div', { className: 'startup-text' }, 'ARQA Launcher')
    ),
    h('div', { className: 'window-frame' },
      h('div', { className: 'metro-background' },
        h('div', { className: 'metro-circle' }),
        h('div', { className: 'metro-ring' }),
        h('div', { className: 'metro-triangle' }),
        h('div', { className: 'metro-square' }),
        h('div', { className: 'metro-line' })
      ),
      h('div', { className: 'titlebar' },
        h('div', { className: 'title-left' },
          h('img', { className: 'app-logo', src: './assets/ArqaLogo.png', alt: 'ARQA' }),
          h('div', null,
            h('span', { className: 'logo' }, 'ARQA'),
            h('span', { className: 'subtitle' }, 'XMB Shell')
          )
        )
      ),
      h('div', { className: 'xmb-main', ref: menuBarRef },
        ...navItems
      ),
      h('main', { className: 'content' },
      h('section', { className: 'card xmb-panel' },
        h('div', { className: 'panel-header' },
          h('div', null,
            h('p', { className: 'section-label' }, activeSection),
            h('h2', null, menuItems.find((item) => item.label === activeSection)?.description)
          ),
          h('p', { className: 'panel-subtitle' }, 'Use D-pad / arrow keys and A / Enter to navigate')
        ),
        h('div', { className: 'xmb-contents' },
          ...submenuItems
        )
      ),
      h('section', { className: 'card console-panel' },
        h('div', { className: 'panel-header' },
          h('div', null,
            h('h2', null, 'Console Output'),
            h('p', { className: 'panel-subtitle' }, consoleState)
          )
        ),
        h('pre', { className: 'console-log' }, consoleLog.join('\n'))
      )
    )
  )
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
