// ArqaLauncher — Discord Content Sanitizer
// CRITICAL SECURITY MODULE: All Discord content MUST pass through this pipeline
// before being sent to the renderer process.
// Prevents XSS, HTML injection, CSS injection, bidi attacks, and UI manipulation.
// No external dependencies — uses only Node.js built-ins.

'use strict';

const { URL } = require('url');

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFE_URL_SCHEMES     = new Set(['https:', 'http:']);
const DISCORD_CDN_HOSTS    = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);
const VALID_STATUSES       = new Set(['online', 'idle', 'dnd', 'offline', 'invisible']);
const SAFE_IMAGE_EXTS      = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const SAFE_VIDEO_EXTS      = new Set(['mp4', 'mov', 'webm']);
const SAFE_ATTACH_EXTS     = new Set([...SAFE_IMAGE_EXTS, ...SAFE_VIDEO_EXTS,
                                      'pdf', 'txt', 'zip', 'mp3', 'ogg', 'wav']);

// Bidi-override / invisible direction characters used in spoofing attacks
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069\u200F\u200E\u061C]/g;
// C0/C1 control chars except tab(\x09), newline(\x0A), carriage-return(\x0D)
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g;

// ── Core text sanitizer ───────────────────────────────────────────────────────

/**
 * Sanitize an arbitrary string for safe display as plain text.
 * React's createElement renders text nodes verbatim (no HTML interpretation)
 * so this mainly defends against invisible/misleading Unicode.
 *
 * @param {*}      value  — raw value (will be coerced to string)
 * @param {number} maxLen — hard truncation limit (default 4 000)
 * @returns {string}
 */
function sanitizeText(value, maxLen = 4000) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  s = s.replace(CTRL_RE, '');   // strip control chars
  s = s.replace(BIDI_RE, '');   // strip bidi overrides
  if (s.length > maxLen) s = s.slice(0, maxLen) + '\u2026';
  return s;
}

// ── URL sanitizers ────────────────────────────────────────────────────────────

/**
 * Sanitize an arbitrary external URL.
 * Returns the URL string if safe, null otherwise.
 */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const p = new URL(url);
    if (!SAFE_URL_SCHEMES.has(p.protocol)) return null;
    const host = p.hostname.toLowerCase();
    if (isPrivateHost(host)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Sanitize a Discord CDN URL.
 * Only allows cdn.discordapp.com and known media proxies.
 */
function sanitizeCdnUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const p = new URL(url);
    if (p.protocol !== 'https:') return null;
    const host = p.hostname.toLowerCase();
    if (!DISCORD_CDN_HOSTS.has(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function isPrivateHost(host) {
  return (
    host === 'localhost'      ||
    host === '127.0.0.1'     ||
    host === '::1'           ||
    /^10\./.test(host)       ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.endsWith('.local')
  );
}

// ── Discord object sanitizers ─────────────────────────────────────────────────

function sanitizeStatus(status) {
  return VALID_STATUSES.has(status) ? status : 'offline';
}

function sanitizeSnowflake(id) {
  if (!id) return '';
  const s = String(id).replace(/[^0-9]/g, '');
  return s.slice(0, 20);
}

function sanitizeTimestamp(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const t = d.getTime();
    const now = Date.now();
    // Reject obviously wrong timestamps (before Discord was founded or >1 day in the future)
    if (t < 1420070400000 || t > now + 86400000) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const uid = sanitizeSnowflake(user.id);
  const discriminator = sanitizeText(String(user.discriminator || '0'), 4).replace(/[^0-9]/g, '') || '0';
  let avatarUrl = null;
  if (user.avatar && uid) {
    avatarUrl = sanitizeCdnUrl(`https://cdn.discordapp.com/avatars/${uid}/${user.avatar}.webp?size=64`);
  }
  if (!avatarUrl) {
    const defaultIndex = (parseInt(discriminator, 10) % 5) || 0;
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }
  return {
    id:           uid,
    username:     sanitizeText(user.username || 'Unknown', 32),
    discriminator,
    globalName:   user.global_name ? sanitizeText(user.global_name, 32) : null,
    avatarUrl,
    bot:          Boolean(user.bot),
    status:       sanitizeStatus(user.status),
  };
}

function sanitizeAttachment(att) {
  if (!att || typeof att !== 'object') return null;
  const url = sanitizeCdnUrl(att.url);
  if (!url) return null;
  const filename = sanitizeText(att.filename || 'file', 128);
  const ext = filename.split('.').pop().toLowerCase();
  return {
    id:       sanitizeSnowflake(att.id),
    filename,
    size:     typeof att.size === 'number' ? Math.max(0, att.size) : 0,
    url,
    proxyUrl: sanitizeCdnUrl(att.proxy_url) || url,
    isImage:  SAFE_IMAGE_EXTS.has(ext),
    isVideo:  SAFE_VIDEO_EXTS.has(ext),
    isSafe:   SAFE_ATTACH_EXTS.has(ext),
  };
}

function sanitizeEmbed(embed) {
  if (!embed || typeof embed !== 'object') return null;
  const fields = Array.isArray(embed.fields)
    ? embed.fields.slice(0, 25).map(f => ({
        name:   sanitizeText(f.name  || '', 256),
        value:  sanitizeText(f.value || '', 1024),
        inline: Boolean(f.inline),
      }))
    : [];
  return {
    type:        sanitizeText(String(embed.type || 'rich'), 20),
    title:       embed.title       ? sanitizeText(embed.title, 256)       : null,
    description: embed.description ? sanitizeText(embed.description, 500) : null,
    url:         sanitizeUrl(embed.url),
    color:       typeof embed.color === 'number' ? (embed.color & 0xFFFFFF) : null,
    timestamp:   embed.timestamp   ? sanitizeTimestamp(embed.timestamp)   : null,
    thumbnail:   embed.thumbnail?.url ? { url: sanitizeCdnUrl(embed.thumbnail.url) } : null,
    image:       embed.image?.url       ? { url: sanitizeCdnUrl(embed.image.url) }       : null,
    author:      embed.author ? {
      name:    sanitizeText(embed.author.name   || '', 256),
      iconUrl: sanitizeCdnUrl(embed.author.icon_url),
      url:     sanitizeUrl(embed.author.url),
    } : null,
    footer:      embed.footer ? {
      text:    sanitizeText(embed.footer.text || '', 256),
      iconUrl: sanitizeCdnUrl(embed.footer.icon_url),
    } : null,
    fields,
  };
}

function sanitizeReaction(reaction) {
  if (!reaction || typeof reaction !== 'object') return null;
  const emoji = reaction.emoji;
  if (!emoji) return null;
  return {
    count:     typeof reaction.count === 'number' ? Math.min(Math.max(0, reaction.count), 99999) : 0,
    meReacted: Boolean(reaction.me),
    emoji: {
      id:       emoji.id ? sanitizeSnowflake(emoji.id) : null,
      name:     sanitizeText(emoji.name || '?', 32),
      animated: Boolean(emoji.animated),
    },
  };
}

function sanitizeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  return {
    id:          sanitizeSnowflake(msg.id),
    content:     sanitizeText(msg.content || '', 4000),
    author:      sanitizeUser(msg.author),
    timestamp:   sanitizeTimestamp(msg.timestamp),
    editedAt:    msg.edited_timestamp ? sanitizeTimestamp(msg.edited_timestamp) : null,
    attachments: Array.isArray(msg.attachments)
      ? msg.attachments.slice(0, 10).map(sanitizeAttachment).filter(Boolean)
      : [],
    embeds: Array.isArray(msg.embeds)
      ? msg.embeds.slice(0, 4).map(sanitizeEmbed).filter(Boolean)
      : [],
    reactions: Array.isArray(msg.reactions)
      ? msg.reactions.slice(0, 20).map(sanitizeReaction).filter(Boolean)
      : [],
    referencedMessage: msg.referenced_message
      ? { id: sanitizeSnowflake(msg.referenced_message.id) }
      : null,
    type:    typeof msg.type === 'number' ? msg.type : 0,
    pinned:  Boolean(msg.pinned),
    tts:     false, // never relay TTS flag to renderer
  };
}

function sanitizeChannel(ch) {
  if (!ch || typeof ch !== 'object') return null;
  const cid = sanitizeSnowflake(ch.id);
  let iconUrl = null;
  if (ch.icon && cid) {
    iconUrl = sanitizeCdnUrl(`https://cdn.discordapp.com/channel-icons/${cid}/${ch.icon}.webp?size=64`);
  }
  return {
    id:            cid,
    type:          typeof ch.type === 'number' ? ch.type : 0,
    name:          ch.name       ? sanitizeText(ch.name,  100) : null,
    topic:         ch.topic      ? sanitizeText(ch.topic, 256) : null,
    nsfw:          Boolean(ch.nsfw),
    position:      typeof ch.position === 'number' ? ch.position : 0,
    parentId:      ch.parent_id  ? sanitizeSnowflake(ch.parent_id) : null,
    guildId:       ch.guild_id   ? sanitizeSnowflake(ch.guild_id)  : null,
    recipients:    Array.isArray(ch.recipients)
      ? ch.recipients.slice(0, 10).map(sanitizeUser).filter(Boolean)
      : [],
    lastMessageId: ch.last_message_id ? sanitizeSnowflake(ch.last_message_id) : null,
    iconUrl,
    unreadCount:   typeof ch.unread_count === 'number' ? ch.unread_count : 0,
  };
}

function sanitizeGuild(guild) {
  if (!guild || typeof guild !== 'object') return null;
  const gid = sanitizeSnowflake(guild.id);
  let iconUrl = null;
  if (guild.icon && gid) {
    iconUrl = sanitizeCdnUrl(`https://cdn.discordapp.com/icons/${gid}/${guild.icon}.webp?size=64`);
  }
  return {
    id:          gid,
    name:        sanitizeText(guild.name || 'Server', 100),
    iconUrl,
    memberCount: typeof guild.approximate_member_count === 'number' ? guild.approximate_member_count : null,
    ownerId:     guild.owner_id ? sanitizeSnowflake(guild.owner_id) : null,
    features:    [], // never relay raw feature flags
  };
}

function sanitizePresence(presence) {
  if (!presence || typeof presence !== 'object') return null;
  const activities = Array.isArray(presence.activities) ? presence.activities : [];
  const activity   = activities.find(a => a.type !== 4) || activities[0]; // skip Custom status (type 4)
  const custom     = activities.find(a => a.type === 4);
  return {
    status: sanitizeStatus(presence.status),
    activity: activity ? {
      name:    sanitizeText(activity.name    || '', 128),
      type:    typeof activity.type === 'number' ? activity.type : 0,
      state:   activity.state   ? sanitizeText(activity.state,   128) : null,
      details: activity.details ? sanitizeText(activity.details, 128) : null,
    } : null,
    customStatus: custom?.state ? sanitizeText(custom.state, 128) : null,
  };
}

function sanitizeFriend(rel) {
  if (!rel || typeof rel !== 'object') return null;
  return {
    id:       sanitizeSnowflake(rel.id),
    type:     typeof rel.type === 'number' ? rel.type : 1,
    user:     sanitizeUser(rel.user),
    presence: rel.presence ? sanitizePresence(rel.presence) : null,
    nickname: rel.nickname ? sanitizeText(rel.nickname, 32) : null,
  };
}

function sanitizeNotification(notif) {
  if (!notif || typeof notif !== 'object') return null;
  return {
    id:        sanitizeSnowflake(notif.id || String(Date.now())),
    type:      sanitizeText(String(notif.type || 'message'), 20),
    title:     sanitizeText(notif.title   || '', 128),
    body:      sanitizeText(notif.body    || '', 256),
    channelId: notif.channel_id ? sanitizeSnowflake(notif.channel_id) : null,
    guildId:   notif.guild_id   ? sanitizeSnowflake(notif.guild_id)   : null,
    timestamp: sanitizeTimestamp(notif.timestamp || new Date().toISOString()),
    read:      Boolean(notif.read),
  };
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

function sanitizeMessages(msgs, max = 100) {
  if (!Array.isArray(msgs)) return [];
  return msgs.slice(0, max).map(sanitizeMessage).filter(Boolean);
}

function sanitizeChannels(channels, max = 500) {
  if (!Array.isArray(channels)) return [];
  return channels.slice(0, max).map(sanitizeChannel).filter(Boolean);
}

function sanitizeGuilds(guilds, max = 200) {
  if (!Array.isArray(guilds)) return [];
  return guilds.slice(0, max).map(sanitizeGuild).filter(Boolean);
}

function sanitizeFriends(rels, max = 500) {
  if (!Array.isArray(rels)) return [];
  return rels.slice(0, max).map(sanitizeFriend).filter(Boolean);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  sanitizeText,
  sanitizeUrl,
  sanitizeCdnUrl,
  sanitizeSnowflake,
  sanitizeTimestamp,
  sanitizeStatus,
  sanitizeUser,
  sanitizeAttachment,
  sanitizeEmbed,
  sanitizeReaction,
  sanitizeMessage,
  sanitizeMessages,
  sanitizeChannel,
  sanitizeChannels,
  sanitizeGuild,
  sanitizeGuilds,
  sanitizePresence,
  sanitizeFriend,
  sanitizeFriends,
  sanitizeNotification,
};
