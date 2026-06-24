// ArqaLauncher — Discord OAuth2 Authentication
// Handles the full Discord OAuth2 authorization code flow using a popup BrowserWindow.
// Tokens are stored encrypted (AES-256-GCM) in the Electron userData directory.
// Tokens are NEVER exposed to the renderer process.

'use strict';

const { BrowserWindow } = require('electron');
const { createCipheriv, createDecipheriv, randomBytes, createHash } = require('crypto');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ── Crypto helpers ────────────────────────────────────────────────────────────

const KEY_LEN   = 32; // AES-256
const IV_LEN    = 12; // GCM recommended
const TAG_LEN   = 16;
const ALGO      = 'aes-256-gcm';

/** Load or generate the persistent encryption key. */
function loadOrCreateKey(keyPath) {
  try {
    const buf = fs.readFileSync(keyPath);
    if (buf.length === KEY_LEN) return buf;
  } catch { /* first run */ }
  const key = randomBytes(KEY_LEN);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function encrypt(key, plaintext) {
  const iv         = randomBytes(IV_LEN);
  const cipher     = createCipheriv(ALGO, key, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag();
  // Layout: iv(12) || tag(16) || ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(key, b64) {
  const buf  = Buffer.from(b64, 'base64');
  const iv   = buf.slice(0, IV_LEN);
  const tag  = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const ct   = buf.slice(IV_LEN + TAG_LEN);
  const dec  = createDecipheriv(ALGO, key, iv);
  dec.setAuthTag(tag);
  return dec.update(ct) + dec.final('utf8');
}

// ── OAuth2 constants ──────────────────────────────────────────────────────────

const DISCORD_API_BASE    = 'https://discord.com/api/v10';
const DISCORD_AUTH_BASE   = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL   = `${DISCORD_API_BASE}/oauth2/token`;
const DISCORD_REVOKE_URL  = `${DISCORD_API_BASE}/oauth2/token/revoke`;

// Fixed local port for the OAuth2 callback server.
// Users must register EXACTLY this URI in their Discord application:
//   http://127.0.0.1:57829/callback
const OAUTH_CALLBACK_PORT = 57829;

// Publicly available OAuth2 scopes (no partner approval required).
// NOTE: dm_channels.read and relationships.read require Discord partner approval;
//       messages.read is documented for local-RPC but also enables REST message reading.
// DM channel list and friends list arrive via the Gateway READY payload instead.
const OAUTH_SCOPES = [
  'identify',
  'guilds',
  'guilds.members.read',
  'messages.read',
].join(' ');

// ── DiscordAuth class ─────────────────────────────────────────────────────────

class DiscordAuth {
  /**
   * @param {string} userDataPath — Electron app.getPath('userData')
   * @param {string} clientId     — Discord application client ID (from Settings)
   * @param {string} clientSecret — Discord application client secret (from Settings)
   */
  constructor(userDataPath, clientId, clientSecret) {
    this._userDataPath   = userDataPath;
    this._clientId       = clientId;
    this._clientSecret   = clientSecret;
    this._keyPath        = path.join(userDataPath, 'arqa-key.bin');
    this._tokenPath      = path.join(userDataPath, 'arqa-discord.enc');
    this._key            = null;
    this._session        = null; // { accessToken, refreshToken, expiresAt, user }
    this._popupWindow    = null;
    this._localServer    = null;
    this._localPort      = 0;
  }

  /** Load key lazily. */
  _getKey() {
    if (!this._key) this._key = loadOrCreateKey(this._keyPath);
    return this._key;
  }

  /** Persist encrypted session to disk. */
  _saveSession() {
    if (!this._session) {
      try { fs.unlinkSync(this._tokenPath); } catch { /* ok */ }
      return;
    }
    try {
      const json    = JSON.stringify(this._session);
      const payload = encrypt(this._getKey(), json);
      fs.mkdirSync(path.dirname(this._tokenPath), { recursive: true });
      fs.writeFileSync(this._tokenPath, payload, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.error('[DiscordAuth] Failed to persist session:', err.message);
    }
  }

  /** Load and decrypt session from disk. Returns the session or null. */
  loadSession() {
    try {
      if (!fs.existsSync(this._tokenPath)) return null;
      const payload = fs.readFileSync(this._tokenPath, 'utf8');
      const json    = decrypt(this._getKey(), payload);
      this._session = JSON.parse(json);
      // Basic validity check
      if (!this._session?.accessToken) { this._session = null; return null; }
      return this._session;
    } catch {
      // Corrupted file — remove it
      try { fs.unlinkSync(this._tokenPath); } catch { /* ok */ }
      this._session = null;
      return null;
    }
  }

  /** Returns the current in-memory session (or loads from disk). */
  getSession() {
    if (this._session) return this._session;
    return this.loadSession();
  }

  /** True if a valid, non-expired token exists. */
  isAuthenticated() {
    const s = this.getSession();
    if (!s) return false;
    // Consider token expired 5 minutes before actual expiry
    return s.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  /** Refresh the access token using the refresh token. */
  async refreshAccessToken() {
    const s = this._session;
    if (!s?.refreshToken) return false;
    try {
      const body = new URLSearchParams({
        client_id:     this._clientId,
        client_secret: this._clientSecret,
        grant_type:    'refresh_token',
        refresh_token: s.refreshToken,
      });
      const data = await this._postForm(DISCORD_TOKEN_URL, body.toString());
      if (!data.access_token) return false;
      this._session = {
        ...s,
        accessToken:  data.access_token,
        refreshToken: data.refresh_token || s.refreshToken,
        expiresAt:    Date.now() + (data.expires_in || 604800) * 1000,
      };
      this._saveSession();
      return true;
    } catch (err) {
      console.error('[DiscordAuth] Token refresh failed:', err.message);
      return false;
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   * Returns null if not authenticated.
   */
  async getAccessToken() {
    if (!this.getSession()) return null;
    if (!this.isAuthenticated()) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return null;
    }
    return this._session.accessToken;
  }

  /**
   * Begin OAuth2 flow.
   * Opens a popup BrowserWindow, starts a local HTTP callback server,
   * and resolves with the session once the user completes login.
   *
   * @param {BrowserWindow} parentWindow
   * @returns {Promise<{user, accessToken}>}
   */
  async startOAuthFlow(parentWindow) {
    if (!this._clientId || !this._clientSecret) {
      throw new Error('Discord client ID and secret are not configured. Set them in Arqa Settings.');
    }

    const port  = await this._startCallbackServer();
    const state = randomBytes(16).toString('hex');
    const redirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

    const authUrl = new URL(DISCORD_AUTH_BASE);
    authUrl.searchParams.set('client_id',     this._clientId);
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope',         OAUTH_SCOPES);
    authUrl.searchParams.set('state',         state);
    authUrl.searchParams.set('prompt',        'consent');

    return new Promise((resolve, reject) => {
      // Inject the resolve/reject so the callback server can call them
      this._pendingAuth = { resolve, reject, state, redirectUri };

      this._popupWindow = new BrowserWindow({
        width:  480,
        height: 700,
        parent: parentWindow,
        modal:  true,
        title:  'Sign in to Discord',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // Disable devtools in auth popup for security
          devTools: false,
        },
      });

      this._popupWindow.setMenuBarVisibility(false);
      this._popupWindow.loadURL(authUrl.toString());

      this._popupWindow.on('closed', () => {
        this._popupWindow = null;
        if (this._pendingAuth) {
          this._pendingAuth.reject(new Error('Login cancelled.'));
          this._pendingAuth = null;
        }
        this._stopCallbackServer();
      });
    });
  }

  /** Handle the OAuth2 callback (called by the local HTTP server). */
  async _handleCallback(code, state) {
    const pending = this._pendingAuth;
    if (!pending) return;
    this._pendingAuth = null;

    // Close popup and server immediately
    if (this._popupWindow && !this._popupWindow.isDestroyed()) {
      this._popupWindow.close();
      this._popupWindow = null;
    }
    this._stopCallbackServer();

    // Verify CSRF state
    if (state !== pending.state) {
      pending.reject(new Error('OAuth state mismatch. Possible CSRF attack.'));
      return;
    }

    try {
      // Exchange code for tokens
      const body = new URLSearchParams({
        client_id:     this._clientId,
        client_secret: this._clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  pending.redirectUri,
      });
      const data = await this._postForm(DISCORD_TOKEN_URL, body.toString());
      if (!data.access_token) {
        pending.reject(new Error('Token exchange failed: no access_token in response.'));
        return;
      }

      // Fetch user info with the new token
      const user = await this._getMe(data.access_token);

      this._session = {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt:    Date.now() + (data.expires_in || 604800) * 1000,
        tokenType:    data.token_type || 'Bearer',
        scope:        data.scope || OAUTH_SCOPES,
        user,
      };
      this._saveSession();
      pending.resolve({ user, accessToken: data.access_token });
    } catch (err) {
      pending.reject(err);
    }
  }

  /** Revoke tokens and clear session. */
  async logout() {
    const s = this._session;
    if (s?.accessToken) {
      try {
        const body = new URLSearchParams({
          client_id:     this._clientId,
          client_secret: this._clientSecret,
          token:         s.accessToken,
        });
        await this._postForm(DISCORD_REVOKE_URL, body.toString());
      } catch { /* best effort */ }
    }
    this._session = null;
    this._saveSession(); // deletes file
  }

  // ── Local callback HTTP server ──────────────────────────────────────────────

  _startCallbackServer() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (!req.url) { res.end(); return; }
        let parsed;
        try { parsed = new URL(req.url, 'http://127.0.0.1'); } catch { res.end(); return; }

        if (parsed.pathname === '/callback') {
          const code  = parsed.searchParams.get('code');
          const state = parsed.searchParams.get('state');
          const error = parsed.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family:sans-serif;color:#fff;background:#05030c;text-align:center;padding:60px"><h2>Login failed.</h2><p>You may close this window.</p></body></html>');
            if (this._pendingAuth) {
              this._pendingAuth.reject(new Error(`Discord denied access: ${error}`));
              this._pendingAuth = null;
            }
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family:sans-serif;color:#fff;background:#05030c;text-align:center;padding:60px"><h2>Signed in!</h2><p>You may close this window and return to Arqa.</p></body></html>');
            this._handleCallback(code, state).catch(console.error);
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
        this._localServer = server;
        this._localPort   = OAUTH_CALLBACK_PORT;
        resolve(OAUTH_CALLBACK_PORT);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(
            `Port ${OAUTH_CALLBACK_PORT} is already in use. Close any other app using that port and try again.`
          ));
        } else {
          reject(err);
        }
      });

      // Auto-close server after 5 minutes if auth not completed
      setTimeout(() => this._stopCallbackServer(), 5 * 60 * 1000);
    });
  }

  _stopCallbackServer() {
    if (this._localServer) {
      this._localServer.close();
      this._localServer = null;
      this._localPort   = 0;
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  _postForm(url, body) {
    return new Promise((resolve, reject) => {
      const u   = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent':     'ArqaLauncher/1.0',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(new Error(`Invalid JSON response: ${e.message}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _getMe(accessToken) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'discord.com',
        path:     '/api/v10/users/@me',
        headers:  {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent':    'ArqaLauncher/1.0',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = { DiscordAuth };
