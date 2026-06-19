const { useState, useEffect, useRef } = React;
const h = React.createElement;

const menuItems = [
  { label: 'Home', description: 'Dashboard' },
  { label: 'Library', description: 'Games & media' },
  { label: 'Launch', description: 'Run Bazzite' },
  { label: 'Settings', description: 'Preferences' }
];

const xmbTiles = [
  { title: 'Games', subtitle: 'Your collection', accent: '#9a70ff' },
  { title: 'Media', subtitle: 'Screenshots & music', accent: '#6ed0ff' },
  { title: 'Network', subtitle: 'Online services', accent: '#ff8eca' },
  { title: 'System', subtitle: 'Tools & settings', accent: '#d498ff' }
];

const App = () => {
  const [activeSection, setActiveSection] = useState('Home');
  const [focusArea, setFocusArea] = useState('menu');
  const [focusedTileIndex, setFocusedTileIndex] = useState(0);
  const [focusedGameIndex, setFocusedGameIndex] = useState(0);
  const [bazzitePath, setBazzitePath] = useState(null);
  const [library, setLibrary] = useState(null);
  const [selectedRom, setSelectedRom] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [consoleLog, setConsoleLog] = useState(['Ready.']);
  const [consoleState, setConsoleState] = useState('Awaiting launch');

  const activeSectionRef = useRef(activeSection);
  const focusAreaRef = useRef(focusArea);
  const focusedTileRef = useRef(focusedTileIndex);
  const focusedGameRef = useRef(focusedGameIndex);
  const libraryRef = useRef(library);
  const selectedRomRef = useRef(selectedRom);
  const bazzitePathRef = useRef(bazzitePath);
  const lastGamepadState = useRef([]);
  const gamepadRAF = useRef(null);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    focusAreaRef.current = focusArea;
  }, [focusArea]);

  useEffect(() => {
    focusedTileRef.current = focusedTileIndex;
  }, [focusedTileIndex]);

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
    if (!window.bazziteAPI) {
      appendConsole('Warning: Bazzite API not available.');
    }
  }, []);

  useEffect(() => {
    const getCurrentIndex = () => menuItems.findIndex((item) => item.label === activeSectionRef.current);

    const handleInput = (input) => {
      const currentFocus = focusAreaRef.current;
      const currentSection = activeSectionRef.current;
      const gameCount = libraryRef.current?.roms?.length || 0;

      switch (input) {
        case 'ArrowLeft':
          if (currentFocus === 'menu') {
            const currentIndex = getCurrentIndex();
            const nextIndex = (currentIndex + menuItems.length - 1) % menuItems.length;
            setActiveSection(menuItems[nextIndex].label);
            setFocusArea('menu');
          } else if (currentFocus === 'tiles') {
            setFocusedTileIndex((prev) => (prev + xmbTiles.length - 1) % xmbTiles.length);
          } else if (currentFocus === 'library') {
            setFocusedGameIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'ArrowRight':
          if (currentFocus === 'menu') {
            const currentIndex = getCurrentIndex();
            const nextIndex = (currentIndex + 1) % menuItems.length;
            setActiveSection(menuItems[nextIndex].label);
            setFocusArea('menu');
          } else if (currentFocus === 'tiles') {
            setFocusedTileIndex((prev) => (prev + 1) % xmbTiles.length);
          } else if (currentFocus === 'library') {
            setFocusedGameIndex((prev) => Math.min(prev + 1, Math.max(gameCount - 1, 0)));
          }
          break;
        case 'ArrowUp':
          setFocusArea('menu');
          break;
        case 'ArrowDown':
          if (currentSection === 'Library') {
            setFocusArea('library');
          } else if (currentSection === 'Launch') {
            setFocusArea('launch');
          } else {
            setFocusArea('tiles');
          }
          break;
        case 'Enter':
          if (currentFocus === 'tiles') {
            setActiveSection('Library');
            setFocusArea('library');
          } else if (currentFocus === 'library' && gameCount > 0) {
            const rom = libraryRef.current.roms[focusedGameRef.current];
            setSelectedRom(rom);
            launchRom(rom);
          } else if (currentFocus === 'launch') {
            const romToLaunch = selectedRomRef.current || libraryRef.current?.roms?.[focusedGameRef.current];
            if (romToLaunch) {
              launchRom(romToLaunch);
            } else {
              chooseFolder();
            }
          }
          break;
        case 'Back':
        case 'Escape':
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
    gamepadRAF.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
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
        return h('div', null,
          h('section', { className: 'card launch-panel' },
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
                h('button', { className: 'secondary-button', onClick: () => {
                  const romToLaunch = selectedRom || currentGames[focusedGameIndex];
                  if (romToLaunch) launchRom(romToLaunch);
                } }, 'Launch')
              )
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
          ),
          h('section', { className: 'tile-row card' },
            ...xmbTiles.map((tile, index) =>
              h('div', {
                key: tile.title,
                className: `xmb-tile ${focusArea === 'tiles' && focusedTileIndex === index ? 'focused' : ''}`,
                style: { '--accent': tile.accent },
                onClick: () => {
                  setFocusedTileIndex(index);
                  setActiveSection('Library');
                  setFocusArea('library');
                }
              },
                h('span', { className: 'tile-title' }, tile.title),
                h('span', { className: 'tile-subtitle' }, tile.subtitle)
              )
            )
          )
        );
    }
  };

  const navItems = menuItems.map((item) =>
    h('div', {
      key: item.label,
      className: `xmb-nav-item ${activeSection === item.label ? 'active' : ''} ${focusArea === 'menu' && activeSection === item.label ? 'focused' : ''}`,
      onClick: () => {
        setActiveSection(item.label);
        setFocusArea('menu');
      }
    },
      h('span', { className: 'nav-label' }, item.label),
      h('span', { className: 'nav-description' }, item.description)
    )
  );

  return h('div', { className: 'window-frame' },
    h('div', { className: 'titlebar' },
      h('div', { className: 'title-left' },
        h('span', { className: 'logo' }, 'ARQA'),
        h('span', { className: 'subtitle' }, 'XMB Shell')
      ),
      h('div', { className: 'window-controls' },
        h('button', { onClick: () => window.bazziteAPI?.minimizeWindow() }, '—'),
        h('button', { onClick: () => window.bazziteAPI?.toggleMaximizeWindow() }, '□'),
        h('button', { onClick: () => window.bazziteAPI?.closeWindow() }, '✕')
      )
    ),
    h('div', { className: 'xmb-nav' },
      ...navItems
    ),
    h('main', { className: 'content' },
      sectionContent(),
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
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
