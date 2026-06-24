// ArqaLauncher — Discord Rich Presence
// Connects to the local Discord client via IPC pipe and updates game presence.
// Works entirely through local IPC — requires the Discord desktop app to be running.
// No API tokens needed; only the Discord Application Client ID is required.
//
// Protocol:
//   Windows: \\.\pipe\discord-ipc-{0..9}
//   Linux:   $XDG_RUNTIME_DIR/discord-ipc-{0..9}  (or /run/user/{uid}/...)
//   macOS:   $TMPDIR/discord-ipc-{0..9}

'use strict';

const net  = require('net');
const os   = require('os');
const path = require('path');
const { randomBytes } = require('crypto');

const OP_HANDSHAKE  = 0;
const OP_FRAME      = 1;
const OP_CLOSE      = 2;
const OP_PING       = 3;
const OP_PONG       = 4;

const ACTIVITY_TYPE_PLAYING = 0;
const MAX_RECONNECT_DELAY   = 30000;

// ── IPC socket path helpers ───────────────────────────────────────────────────

function getPipePaths() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const runtimeDir =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR          ||
    (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'discord') : null) ||
    `/run/user/${process.getuid ? process.getuid() : 1000}`;
  return Array.from({ length: 10 }, (_, i) => path.join(runtimeDir, `discord-ipc-${i}`));
}

// ── Packet codec ─────────────────────────────────────────────────────────────

function encodePacket(op, data) {
  const json = JSON.stringify(data);
  const body = Buffer.from(json, 'utf8');
  const buf  = Buffer.allocUnsafe(8 + body.length);
  buf.writeUInt32LE(op,          0);
  buf.writeUInt32LE(body.length, 4);
  body.copy(buf, 8);
  return buf;
}

function decodePackets(buf) {
  const packets = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const op  = buf.readUInt32LE(offset);
    const len = buf.readUInt32LE(offset + 4);
    if (offset + 8 + len > buf.length) break;
    const body = buf.slice(offset + 8, offset + 8 + len).toString('utf8');
    try { packets.push({ op, data: JSON.parse(body) }); }
    catch { /* malformed packet — skip */ }
    offset += 8 + len;
  }
  return { packets, remaining: buf.slice(offset) };
}

// ── DiscordPresence ───────────────────────────────────────────────────────────

class DiscordPresence {
  /**
   * @param {string} clientId — Discord Application Client ID (public, safe to include)
   */
  constructor(clientId) {
    this._clientId      = clientId;
    this._socket        = null;
    this._connected     = false;
    this._nonce         = null;
    this._recvBuf       = Buffer.alloc(0);
    this._reconnTimer   = null;
    this._reconnDelay   = 2000;
    this._pendingActivity = null;
    this._currentActivity = null;
    this._stopped       = false;
  }

  /** Start the connection loop. */
  start() {
    this._stopped = false;
    this._connect();
  }

  /** Stop and disconnect. */
  stop() {
    this._stopped = true;
    clearTimeout(this._reconnTimer);
    if (this._socket) {
      try { this._socket.destroy(); } catch { /* ok */ }
      this._socket = null;
    }
    this._connected = false;
  }

  /** Update the rich presence activity. Pass null to clear. */
  setActivity(activity) {
    this._pendingActivity = activity;
    if (this._connected) this._sendActivity();
  }

  /** Clear the rich presence. */
  clearActivity() {
    this.setActivity(null);
  }

  // ── Connection ────────────────────────────────────────────────────────────

  _connect() {
    if (this._stopped) return;
    this._tryNextPipe(getPipePaths(), 0);
  }

  _tryNextPipe(pipes, index) {
    if (this._stopped) return;
    if (index >= pipes.length) {
      // Could not connect — schedule retry
      this._scheduleReconnect();
      return;
    }
    const sock = net.createConnection(pipes[index]);
    sock.setTimeout(3000);

    const onError = () => {
      sock.destroy();
      this._tryNextPipe(pipes, index + 1);
    };

    sock.once('error', onError);
    sock.once('timeout', onError);
    sock.once('connect', () => {
      sock.removeListener('error', onError);
      sock.removeListener('timeout', onError);
      this._socket = sock;
      this._recvBuf = Buffer.alloc(0);
      this._setupSocket();
      this._handshake();
    });
  }

  _setupSocket() {
    const sock = this._socket;

    sock.on('data', (chunk) => {
      this._recvBuf = Buffer.concat([this._recvBuf, chunk]);
      const { packets, remaining } = decodePackets(this._recvBuf);
      this._recvBuf = remaining;
      for (const pkt of packets) this._handlePacket(pkt);
    });

    sock.on('error', () => this._handleDisconnect());
    sock.on('close', () => this._handleDisconnect());
    sock.on('end',   () => this._handleDisconnect());
  }

  _handshake() {
    this._send(OP_HANDSHAKE, { v: 1, client_id: this._clientId });
  }

  _handlePacket({ op, data }) {
    switch (op) {
      case OP_FRAME: {
        const evt = data?.evt;
        const cmd = data?.cmd;
        if (evt === 'READY') {
          this._connected   = true;
          this._reconnDelay = 2000;
          // Send any pending activity immediately
          if (this._pendingActivity !== undefined) this._sendActivity();
        } else if (evt === 'ERROR') {
          console.warn('[DiscordPresence] RPC error:', data?.data?.message);
        }
        break;
      }
      case OP_CLOSE:
        this._handleDisconnect();
        break;
      case OP_PING:
        this._send(OP_PONG, data);
        break;
      default:
        break;
    }
  }

  _handleDisconnect() {
    this._connected    = false;
    this._currentActivity = null;
    if (this._socket) {
      try { this._socket.destroy(); } catch { /* ok */ }
      this._socket = null;
    }
    if (!this._stopped) this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    this._reconnDelay = Math.min(this._reconnDelay * 1.5, MAX_RECONNECT_DELAY);
    clearTimeout(this._reconnTimer);
    this._reconnTimer = setTimeout(() => this._connect(), this._reconnDelay);
  }

  _send(op, data) {
    if (!this._socket || this._socket.destroyed) return;
    try { this._socket.write(encodePacket(op, data)); }
    catch { /* ok */ }
  }

  _sendActivity() {
    const activity = this._pendingActivity;

    // Deduplicate — only send if activity actually changed
    if (JSON.stringify(activity) === JSON.stringify(this._currentActivity)) return;
    this._currentActivity = activity;

    const nonce = randomBytes(8).toString('hex');
    if (activity === null) {
      this._send(OP_FRAME, {
        cmd:   'SET_ACTIVITY',
        args:  { pid: process.pid, activity: null },
        nonce,
      });
    } else {
      this._send(OP_FRAME, {
        cmd:   'SET_ACTIVITY',
        args:  { pid: process.pid, activity },
        nonce,
      });
    }
  }

  get isConnected() { return this._connected; }
}

// ── Convenience activity builders ─────────────────────────────────────────────

/**
 * Build a Rich Presence activity for a launched game.
 *
 * @param {object} opts
 * @param {string} opts.gameName     — e.g. "Persona 3 Reload"
 * @param {string} opts.platform     — e.g. "PlayStation 2"
 * @param {string} opts.launchSource — e.g. "Steam" | "ROM" | "App"
 * @param {number} opts.startTimestamp — Unix seconds (Date.now() / 1000)
 * @param {string} [opts.largeImageKey]
 * @param {string} [opts.smallImageKey]
 * @returns {object} Discord activity payload
 */
function buildGameActivity({ gameName, platform, launchSource, startTimestamp, largeImageKey, smallImageKey } = {}) {
  const details = gameName ? `Playing ${gameName}` : 'Browsing ArqaLauncher';
  const state   = platform ? `${platform} via Arqa` : 'via Arqa';

  const activity = {
    type:       ACTIVITY_TYPE_PLAYING,
    details,
    state,
    timestamps: { start: startTimestamp || Math.floor(Date.now() / 1000) },
    assets: {
      large_image: largeImageKey  || 'arqa_logo',
      large_text:  'ArqaLauncher',
      small_image: smallImageKey  || null,
      small_text:  launchSource   || null,
    },
  };

  return activity;
}

/**
 * Build an idle / browsing activity.
 */
function buildIdleActivity() {
  return {
    type:    ACTIVITY_TYPE_PLAYING,
    details: 'Browsing ArqaLauncher',
    state:   'Idle',
    assets:  {
      large_image: 'arqa_logo',
      large_text:  'ArqaLauncher',
    },
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { DiscordPresence, buildGameActivity, buildIdleActivity };
