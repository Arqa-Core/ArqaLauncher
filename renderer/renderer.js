const { useState, useEffect } = React;

const App = () => {
  const [bazzitePath, setBazzitePath] = useState(null);
  const [library, setLibrary] = useState(null);
  const [selectedRom, setSelectedRom] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [consoleLog, setConsoleLog] = useState(['Ready.']);
  const [consoleState, setConsoleState] = useState('Awaiting launch');

  useEffect(() => {
    window.bazziteAPI.onOutput((message) => {
      appendConsole(message.trim());
      setStatus('Running');
      setConsoleState('Running');
    });

    window.bazziteAPI.onExit((code) => {
      appendConsole(`Bazzite process exited with code ${code}`);
      setStatus('Idle');
      setConsoleState(`Exited (${code})`);
    });
  }, []);

  const appendConsole = (line) => {
    setConsoleLog((current) => [...current, line]);
  };

  const chooseBazzite = async () => {
    const selected = await window.bazziteAPI.selectBazziteExecutable();
    if (selected) {
      setBazzitePath(selected);
      setStatus('Bazzite ready');
      appendConsole(`Bazzite executable set to: ${selected}`);
    }
  };

  const chooseFolder = async () => {
    const result = await window.bazziteAPI.selectRomFolder();
    if (!result) {
      return;
    }
    setLibrary(result);
    appendConsole(`Loaded library from: ${result.folderPath}`);
  };

  const launchRom = async (rom) => {
    if (!bazzitePath) {
      appendConsole('Please set the Bazzite executable first.');
      return;
    }

    const romPath = `${library.folderPath.replace(/\\/g, '/')}/${rom}`;
    setSelectedRom(rom);
    setStatus('Launching...');
    setConsoleState('Starting Bazzite');

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

    appendConsole(`Launching ROM: ${romPath}`);
    setStatus('Running');
  };

  return (
    <div className="window-frame">
      <div className="titlebar">
        <div className="title-left">
          <span className="logo">ARQA</span>
          <span className="subtitle">XMB Shell</span>
        </div>
        <div className="window-controls">
          <button onClick={() => window.bazziteAPI.minimizeWindow()}>—</button>
          <button onClick={() => window.bazziteAPI.toggleMaximizeWindow()}>□</button>
          <button onClick={() => window.bazziteAPI.closeWindow()}>✕</button>
        </div>
      </div>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-item active">Home</div>
          <div className="sidebar-item">Library</div>
          <div className="sidebar-item">Launch</div>
          <div className="sidebar-item">Settings</div>
          <div className="sidebar-footer">
            <div className="status-label">Status</div>
            <div className="status-chip">{status}</div>
          </div>
        </aside>

        <main className="content">
          <section className="hero card">
            <div className="hero-copy">
              <h1>PS3 XMB-Inspired Frontend</h1>
              <p>Elegant black and violet interface built in React for Bazzite emulation control.</p>
            </div>
            <div className="hero-actions">
              <button className="action-button" onClick={chooseBazzite}>Set Bazzite EXE</button>
              <button className="action-button" onClick={chooseFolder}>Browse Game Folder</button>
            </div>
          </section>

          <section className="card library-panel">
            <div className="panel-header">
              <div>
                <h2>Game Library</h2>
                <p className="panel-subtitle">{library ? library.folderPath : 'No folder selected'}</p>
              </div>
              <button className="secondary-button" onClick={() => library && setLibrary({ ...library })}>Refresh</button>
            </div>

            <div className={`game-grid ${!library || library.roms.length === 0 ? 'empty' : ''}`}>
              {!library || library.roms.length === 0 ? (
                <div className="placeholder-card">
                  <p>No compatible game files found. Pick a folder with ISO/PBP/CUE/ELF.</p>
                </div>
              ) : (
                library.roms.map((rom) => (
                  <div key={rom} className="game-card" onClick={() => launchRom(rom)}>
                    <h3>{rom}</h3>
                    <p>Click to launch with Bazzite</p>
                    <span className="launch-prompt">▶</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card console-panel">
            <div className="panel-header">
              <div>
                <h2>Console Output</h2>
                <p className="panel-subtitle">{consoleState}</p>
              </div>
            </div>
            <pre className="console-log">{consoleLog.join('\n')}</pre>
          </section>
        </main>
      </div>
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
