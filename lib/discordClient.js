// ArqaLauncher — Discord REST API Client + Gateway
// Provides:
//   - DiscordRestClient: authenticated HTTPS calls to Discord REST API v10
//   - DiscordGateway: WebSocket connection to Discord's real-time gateway
//
// All tokens stay in the main process. The renderer receives only sanitized data
// via IPC events dispatched by DiscordGateway.

'use strict';

const https      = require('https');
const { EventEmitter } = require('events');
const { sanitizeMessages, sanitizeChannels, sanitizeGuilds,
        sanitizeFriends, sanitizeChannel, sanitizeMessage,
        sanitizePresence, sanitizeUser, sanitizeGuild,
        sanitizeNotification } = require('./discordSanitizer');

const DISCORD_API    = 'https://discord.com/api/v10';
const DISCORD_CDN    = 'https://cdn.discordapp.com';
const GATEWAY_URL    = 'wss://gateway.discord.gg/?v=10&encoding=json';
const USER_AGENT     = 'ArqaLauncher/1.0 (https://github.com/ArqaLauncher)';

// ── Gateway Opcodes ──────────────────────────────────────────────────────────
const OP = {
  DISPATCH:            0,
  HEARTBEAT:           1,
  IDENTIFY:            2,
  PRESENCE_UPDATE:     3,
  VOICE_STATE_UPDATE:  4,
  RESUME:              6,
  RECONNECT:           7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION:     9,
  HELLO:               10,
  HEARTBEAT_ACK:       11,
};

// ── Rate limiter (simple token-bucket) ───────────────────────────────────────
class RateLimiter {
  constructor(requests = 50, windowMs = 1000) {
    this._max     = requests;
    this._window  = windowMs;
    this._queue   = [];
    this._running = false;
  }

  schedule(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._running) this._drain();
    });
  }

  async _drain() {
    this._running = true;
    while (this._queue.length) {
      const { fn, resolve, reject } = this._queue.shift();
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      // Small throttle between requests to avoid burst violations
      await new Promise(r => setTimeout(r, 50));
    }
    this._running = false;
  }
}

// ── Discord REST Client ───────────────────────────────────────────────────────

class DiscordRestClient {
  constructor() {
    this._token      = null;
    this._tokenType  = 'Bearer';
    this._limiter    = new RateLimiter(45, 1000);
  }

  setToken(token, type = 'Bearer') {
    this._token     = token;
    this._tokenType = type;
  }

  clearToken() {
    this._token    = null;
  }

  // ── Low-level request ────────────────────────────────────────────────────

  _request(method, endpoint, body = null) {
    return this._limiter.schedule(() => new Promise((resolve, reject) => {
      const url  = new URL(endpoint.startsWith('http') ? endpoint : `${DISCORD_API}${endpoint}`);
      const auth = this._token ? `${this._tokenType} ${this._token}` : null;

      const headers = {
        'User-Agent': USER_AGENT,
        'Accept':     'application/json',
      };
      if (auth) headers['Authorization'] = auth;

      let bodyData = null;
      if (body !== null) {
        bodyData = JSON.stringify(body);
        headers['Content-Type']   = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const req = https.request({
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          // Handle rate limit
          if (res.statusCode === 429) {
            const retryAfter = parseFloat(res.headers['x-ratelimit-reset-after'] || '1') * 1000;
            setTimeout(() => {
              this._request(method, endpoint, body).then(resolve).catch(reject);
            }, retryAfter + 100);
            return;
          }

          if (res.statusCode === 204) { resolve(null); return; }

          let json;
          try { json = JSON.parse(Buffer.concat(chunks).toString()); }
          catch { reject(new Error(`Non-JSON response: HTTP ${res.statusCode}`)); return; }

          if (res.statusCode >= 400) {
            const msg = json?.message || `HTTP ${res.statusCode}`;
            const err = new Error(`Discord API error: ${msg}`);
            err.code  = json?.code;
            err.status = res.statusCode;
            reject(err);
            return;
          }
          resolve(json);
        });
      });

      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    }));
  }

  get(endpoint)         { return this._request('GET',    endpoint); }
  post(endpoint, body)  { return this._request('POST',   endpoint, body); }
  patch(endpoint, body) { return this._request('PATCH',  endpoint, body); }
  delete(endpoint)      { return this._request('DELETE', endpoint); }
  put(endpoint, body)   { return this._request('PUT',    endpoint, body); }

  // ── User & Auth ──────────────────────────────────────────────────────────

  async getMe()      { return this.get('/users/@me'); }
  async getMyGuilds(){ return this.get('/users/@me/guilds'); }

  // ── Relationships (friends) — uses undocumented but stable endpoint ───────
  async getRelationships() { return this.get('/users/@me/relationships'); }

  // ── Channels / DMs ────────────────────────────────────────────────────────

  async getMyChannels()          { return this.get('/users/@me/channels'); }
  async getChannel(id)           { return this.get(`/channels/${id}`); }
  async getChannelMessages(channelId, { limit = 50, before, after, around } = {}) {
    const params = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
    if (before) params.set('before', before);
    if (after)  params.set('after',  after);
    if (around) params.set('around', around);
    return this.get(`/channels/${channelId}/messages?${params}`);
  }
  async sendMessage(channelId, content, { replyTo, nonce } = {}) {
    const body = {
      content: String(content).slice(0, 2000),
      ...(nonce  && { nonce:              String(nonce)  }),
      ...(replyTo && { message_reference: { message_id: String(replyTo), fail_if_not_exists: false } }),
    };
    return this.post(`/channels/${channelId}/messages`, body);
  }
  async editMessage(channelId, messageId, content) {
    return this.patch(`/channels/${channelId}/messages/${messageId}`, {
      content: String(content).slice(0, 2000),
    });
  }
  async deleteMessage(channelId, messageId) {
    return this.delete(`/channels/${channelId}/messages/${messageId}`);
  }
  async addReaction(channelId, messageId, emoji) {
    const enc = encodeURIComponent(emoji);
    return this.put(`/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`, null);
  }
  async removeReaction(channelId, messageId, emoji) {
    const enc = encodeURIComponent(emoji);
    return this.delete(`/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`);
  }
  async openDM(userId) {
    return this.post('/users/@me/channels', { recipient_id: String(userId) });
  }
  async ackMessage(channelId, messageId) {
    return this.post(`/channels/${channelId}/messages/${messageId}/ack`, { manual: true, mention_count: 0 });
  }

  // ── Guilds ─────────────────────────────────────────────────────────────────

  async getGuildChannels(guildId) { return this.get(`/guilds/${guildId}/channels`); }
  async getGuildMembers(guildId, limit = 100) {
    return this.get(`/guilds/${guildId}/members?limit=${limit}`);
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async getMyMentions(limit = 25) {
    return this.get(`/users/@me/mentions?limit=${limit}`);
  }
}

// ── Discord Gateway ───────────────────────────────────────────────────────────

class DiscordGateway extends EventEmitter {
  /**
   * @param {DiscordRestClient} restClient
   */
  constructor(restClient) {
    super();
    this._rest          = restClient;
    this._token         = null;
    this._ws            = null;
    this._heartbeatTimer = null;
    this._seq           = null;
    this._sessionId     = null;
    this._resumeUrl     = null;
    this._reconnecting  = false;
    this._intentional   = false;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 60000;
    this._connecting    = false;
  }

  setToken(token) { this._token = token; }

  connect(token) {
    if (token) this._token = token;
    if (!this._token) return;
    if (this._connecting || (this._ws && this._ws.readyState <= 1)) return;
    this._connecting  = true;
    this._intentional = false;
    const url = this._resumeUrl && this._sessionId && this._seq !== null
      ? `${this._resumeUrl}?v=10&encoding=json`
      : GATEWAY_URL;
    this._openWs(url);
  }

  _openWs(url) {
    // Node.js 22 / Electron 42 — built-in WebSocket
    try {
      this._ws = new WebSocket(url);
    } catch (err) {
      console.error('[DiscordGateway] WebSocket constructor failed:', err.message);
      this._connecting = false;
      this.emit('error', err);
      return;
    }

    this._ws.onopen = () => {
      this._connecting     = false;
      this._reconnectDelay = 1000;
    };

    this._ws.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); }
      catch { return; }
      this._handlePayload(payload);
    };

    this._ws.onerror = (event) => {
      this.emit('error', new Error('WebSocket error'));
    };

    this._ws.onclose = (event) => {
      this._connecting = false;
      this._clearHeartbeat();
      if (!this._intentional) {
        this.emit('disconnected');
        // Exponential back-off reconnect
        setTimeout(() => {
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
          this.connect();
        }, this._reconnectDelay);
      }
    };
  }

  _handlePayload(p) {
    if (p.s !== null && p.s !== undefined) this._seq = p.s;

    switch (p.op) {
      case OP.HELLO: {
        const interval = p.d?.heartbeat_interval || 41250;
        this._startHeartbeat(interval);
        if (this._sessionId && this._seq !== null) {
          this._send(OP.RESUME, {
            token:      this._token,
            session_id: this._sessionId,
            seq:        this._seq,
          });
        } else {
          this._identify();
        }
        break;
      }
      case OP.HEARTBEAT_ACK:
        // Connection healthy
        break;
      case OP.HEARTBEAT:
        this._sendHeartbeat();
        break;
      case OP.RECONNECT:
        this._reconnect(true);
        break;
      case OP.INVALID_SESSION: {
        const resumable = Boolean(p.d);
        if (!resumable) {
          this._sessionId = null;
          this._seq       = null;
          this._resumeUrl = null;
        }
        setTimeout(() => this._identify(), resumable ? 1000 : 2000);
        break;
      }
      case OP.DISPATCH:
        this._handleDispatch(p.t, p.d);
        break;
      default:
        break;
    }
  }

  _handleDispatch(event, data) {
    switch (event) {
      case 'READY': {
        this._sessionId = data.session_id;
        this._resumeUrl = data.resume_gateway_url;
        // The READY payload for user OAuth2 sessions includes private_channels
        // and relationships — extract them here so main.js can cache them.
        const readyPrivateChannels = sanitizeChannels(Array.isArray(data.private_channels) ? data.private_channels : []);
        const readyRelationships   = sanitizeFriends(Array.isArray(data.relationships)     ? data.relationships   : []);
        const readyGuilds          = Array.isArray(data.guilds) ? data.guilds : [];
        this.emit('ready', {
          user:            sanitizeUser(data.user),
          privateChannels: readyPrivateChannels,
          relationships:   readyRelationships,
          guilds:          readyGuilds,
        });
        break;
      }

      case 'RESUMED':
        this.emit('resumed');
        break;

      // Messages
      case 'MESSAGE_CREATE':
        this.emit('messageCreate', sanitizeMessage(data));
        break;
      case 'MESSAGE_UPDATE':
        this.emit('messageUpdate', sanitizeMessage(data));
        break;
      case 'MESSAGE_DELETE':
        this.emit('messageDelete', {
          id:        data.id,
          channelId: data.channel_id,
          guildId:   data.guild_id || null,
        });
        break;

      // Presence & typing
      case 'PRESENCE_UPDATE':
        this.emit('presenceUpdate', {
          userId:   data.user?.id,
          guildId:  data.guild_id || null,
          presence: sanitizePresence(data),
        });
        break;
      case 'TYPING_START':
        this.emit('typingStart', {
          channelId: data.channel_id,
          userId:    data.user_id,
          guildId:   data.guild_id || null,
          timestamp: data.timestamp,
        });
        break;

      // Channels
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        this.emit('channelUpdate', sanitizeChannel(data));
        break;
      case 'CHANNEL_DELETE':
        this.emit('channelDelete', { id: data.id });
        break;

      // Reactions
      case 'MESSAGE_REACTION_ADD':
      case 'MESSAGE_REACTION_REMOVE':
        this.emit('reactionUpdate', {
          type:      event === 'MESSAGE_REACTION_ADD' ? 'add' : 'remove',
          messageId: data.message_id,
          channelId: data.channel_id,
          userId:    data.user_id,
          emoji:     data.emoji,
        });
        break;

      // Relationships / friends
      case 'RELATIONSHIP_ADD':
        this.emit('relationshipAdd', { id: data.id, type: data.type, user: sanitizeUser(data.user) });
        break;
      case 'RELATIONSHIP_REMOVE':
        this.emit('relationshipRemove', { id: data.id });
        break;

      // Guild events
      case 'GUILD_CREATE': {
        const sanitized = sanitizeGuild(data);
        if (!sanitized) break;
        const channels = sanitizeChannels(Array.isArray(data.channels) ? data.channels : []);
        this.emit('guildCreate', { ...sanitized, channels });
        break;
      }
      case 'GUILD_UPDATE':
        this.emit('guildUpdate', sanitizeGuild(data));
        break;
      case 'GUILD_DELETE':
        this.emit('guildDelete', { id: data.id });
        break;

      case 'NOTIFICATION_CENTER_ITEM_CREATE':
        this.emit('notification', sanitizeNotification(data));
        break;

      default:
        // Ignore unhandled events
        break;
    }
  }

  _identify() {
    this._send(OP.IDENTIFY, {
      token:      this._token,
      intents:    0, // 0 = all available for the token type
      properties: {
        os:      process.platform,
        browser: 'ArqaLauncher',
        device:  'ArqaLauncher',
      },
      presence: {
        activities: [],
        status:     'online',
        afk:        false,
      },
    });
  }

  _startHeartbeat(intervalMs) {
    this._clearHeartbeat();
    // Send an initial heartbeat after a random jitter (Discord recommendation)
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      this._sendHeartbeat();
      this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), intervalMs);
    }, jitter);
  }

  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _sendHeartbeat() {
    this._send(OP.HEARTBEAT, this._seq);
  }

  _send(op, data) {
    if (this._ws?.readyState === 1 /* OPEN */) {
      this._ws.send(JSON.stringify({ op, d: data }));
    }
  }

  /** Update the user's status / presence. */
  updatePresence({ status = 'online', activities = [] } = {}) {
    this._send(OP.PRESENCE_UPDATE, {
      since:      null,
      activities,
      status,
      afk:        false,
    });
  }

  _reconnect(closeGracefully = false) {
    this._clearHeartbeat();
    if (this._ws) {
      try {
        if (closeGracefully) this._ws.close(4000);
        else this._ws.close();
      } catch { /* ok */ }
      this._ws = null;
    }
    setTimeout(() => this.connect(), 500);
  }

  disconnect() {
    this._intentional = true;
    this._clearHeartbeat();
    if (this._ws) {
      try { this._ws.close(1000); } catch { /* ok */ }
      this._ws = null;
    }
    this._sessionId = null;
    this._seq       = null;
    this._resumeUrl = null;
  }

  get connected() {
    return this._ws?.readyState === 1;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { DiscordRestClient, DiscordGateway };
