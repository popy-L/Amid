import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SPOTIFY_ACCOUNTS_URL = "https://accounts.spotify.com";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const BASE_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
];
const TASTE_SCOPES = ["user-top-read", "user-read-recently-played"];

function safeJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function spotifySearchUrl(query) {
  return `https://open.spotify.com/search/${encodeURIComponent(cleanText(query, 180))}`;
}

function publicTrack(track) {
  const artists = Array.isArray(track?.artists) ? track.artists.map((artist) => artist.name).filter(Boolean) : [];
  return {
    id: track?.id || "",
    uri: track?.uri || "",
    name: track?.name || "未知歌曲",
    artists,
    artist: artists.join("、"),
    album: track?.album?.name || "",
    image: track?.album?.images?.[1]?.url || track?.album?.images?.[0]?.url || "",
    durationMs: Number(track?.duration_ms) || 0,
    openUrl: track?.external_urls?.spotify || (track?.id ? `https://open.spotify.com/track/${track.id}` : ""),
  };
}

export class SpotifyService {
  constructor(dataDir) {
    this.dataDir = resolve(dataDir);
    this.file = join(this.dataDir, "spotify.json");
    this.pendingAuthorizations = new Map();
    this.config = this.load();
  }

  load() {
    const stored = safeJsonFile(this.file, {});
    return {
      version: 1,
      enabled: stored.enabled !== false,
      clientId: cleanText(stored.clientId, 100),
      allowPlayback: stored.allowPlayback === true,
      includeTaste: stored.includeTaste === true,
      account: stored.account && typeof stored.account === "object" ? stored.account : null,
      token: stored.token && typeof stored.token === "object" ? stored.token : null,
    };
  }

  save() {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), "utf8");
  }

  scopes() {
    return String(this.config.token?.scope || "").split(/\s+/).filter(Boolean);
  }

  isConnected() {
    return Boolean(this.config.clientId && (this.config.token?.refreshToken || this.config.token?.accessToken));
  }

  isPremium() {
    return String(this.config.account?.product || "").toLowerCase() === "premium";
  }

  canControlPlayback() {
    return this.config.allowPlayback && this.isConnected() && this.isPremium() && this.scopes().includes("user-modify-playback-state");
  }

  publicConfig(redirectUri = "") {
    const connected = this.isConnected();
    return {
      enabled: this.config.enabled !== false,
      clientId: this.config.clientId,
      configured: Boolean(this.config.clientId),
      connected,
      allowPlayback: this.config.allowPlayback,
      includeTaste: this.config.includeTaste,
      account: connected ? {
        displayName: this.config.account?.displayName || "Spotify 用户",
        product: this.config.account?.product || "unknown",
      } : null,
      scopes: connected ? this.scopes() : [],
      premium: this.isPremium(),
      controlAvailable: this.canControlPlayback(),
      mode: this.canControlPlayback() ? "control" : "link",
      redirectUri,
    };
  }

  setConfig(input = {}) {
    const nextClientId = cleanText(input.clientId, 100);
    if (nextClientId && !/^[a-zA-Z0-9_-]{12,100}$/.test(nextClientId)) throw new Error("Spotify Client ID 格式不正确");
    if (nextClientId !== this.config.clientId) {
      this.config.token = null;
      this.config.account = null;
    }
    this.config.clientId = nextClientId;
    this.config.enabled = input.enabled !== false;
    this.config.allowPlayback = input.allowPlayback === true;
    this.config.includeTaste = input.includeTaste === true;
    this.save();
    return this.publicConfig();
  }

  disconnect() {
    this.config.token = null;
    this.config.account = null;
    this.save();
  }

  createAuthorization({ redirectUri, returnTo = "" }) {
    if (!this.config.clientId) throw new Error("请先填写 Spotify Client ID");
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(24));
    const scopes = [...BASE_SCOPES, ...(this.config.includeTaste ? TASTE_SCOPES : [])];
    this.pendingAuthorizations.set(state, { verifier, redirectUri, returnTo, createdAt: Date.now() });
    for (const [key, pending] of this.pendingAuthorizations) {
      if (Date.now() - pending.createdAt > 10 * 60 * 1000) this.pendingAuthorizations.delete(key);
    }
    const url = new URL(`${SPOTIFY_ACCOUNTS_URL}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
      show_dialog: "true",
    }).toString();
    return { url: url.toString(), redirectUri, scopes };
  }

  async tokenRequest(body) {
    const response = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.error || `Spotify 授权返回 ${response.status}`);
    return payload;
  }

  saveToken(payload, previousRefreshToken = "") {
    this.config.token = {
      accessToken: payload.access_token || "",
      refreshToken: payload.refresh_token || previousRefreshToken || "",
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
      scope: payload.scope || this.config.token?.scope || "",
      tokenType: payload.token_type || "Bearer",
    };
    this.save();
  }

  async completeAuthorization({ code, state, redirectUri }) {
    const pending = this.pendingAuthorizations.get(state);
    this.pendingAuthorizations.delete(state);
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error("Spotify 授权状态已失效，请重新连接");
    if (pending.redirectUri !== redirectUri) throw new Error("Spotify 回调地址与授权请求不一致");
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: pending.verifier,
    });
    this.saveToken(token);
    try {
      const profile = await this.api("/me");
      this.config.account = {
        accountId: profile.account_id || profile.id || "",
        displayName: profile.display_name || profile.id || "Spotify 用户",
        product: profile.product || "unknown",
      };
      this.save();
    } catch {
      this.config.account = { displayName: "Spotify 用户", product: "unknown" };
      this.save();
    }
    return { returnTo: pending.returnTo, config: this.publicConfig(redirectUri) };
  }

  async accessToken() {
    if (!this.isConnected()) throw new Error("Spotify 尚未连接");
    if (this.config.token.accessToken && Date.now() < Number(this.config.token.expiresAt || 0) - 60_000) return this.config.token.accessToken;
    if (!this.config.token.refreshToken) throw new Error("Spotify 授权已过期，请重新连接");
    const payload = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: this.config.token.refreshToken,
      client_id: this.config.clientId,
    });
    this.saveToken(payload, this.config.token.refreshToken);
    return this.config.token.accessToken;
  }

  async api(path, options = {}) {
    const token = await this.accessToken();
    const response = await fetch(`${SPOTIFY_API_URL}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return { ok: true };
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.error_description || `Spotify 返回 ${response.status}`);
    return payload;
  }

  async findMusic(input = {}) {
    const query = cleanText(input.query || input.song || input.mood, 180);
    if (!query) throw new Error("请告诉我要找什么歌、歌手或氛围");
    const openUrl = spotifySearchUrl(query);
    if (!this.isConnected()) return { mode: "link", query, openUrl, message: "打开 Spotify 后由用户开始播放" };
    try {
      const limit = Math.max(1, Math.min(8, Number(input.limit) || 5));
      const payload = await this.api(`/search?${new URLSearchParams({ q: query, type: "track", limit: String(limit) })}`);
      const tracks = (payload.tracks?.items || []).map(publicTrack);
      return { mode: this.canControlPlayback() ? "control" : "link", query, openUrl: tracks[0]?.openUrl || openUrl, tracks };
    } catch (error) {
      return { mode: "link", query, openUrl, warning: error.message || "Spotify 搜索暂不可用" };
    }
  }

  async playbackState() {
    if (!this.isConnected()) throw new Error("Spotify 尚未连接；当前只能生成打开链接");
    const state = await this.api("/me/player");
    return {
      playing: state.is_playing === true,
      progressMs: Number(state.progress_ms) || 0,
      device: state.device ? { id: state.device.id || "", name: state.device.name || "", type: state.device.type || "", volume: state.device.volume_percent } : null,
      track: state.item ? publicTrack(state.item) : null,
    };
  }

  async devices() {
    if (!this.isConnected()) throw new Error("Spotify 尚未连接");
    const payload = await this.api("/me/player/devices");
    return { devices: (payload.devices || []).map((device) => ({ id: device.id || "", name: device.name || "", type: device.type || "", active: device.is_active === true, volume: device.volume_percent, restricted: device.is_restricted === true })) };
  }

  async control(input = {}) {
    if (!this.canControlPlayback()) throw new Error("Spotify 自动控制未获准，或当前账户不是 Premium");
    const action = cleanText(input.action, 30).toLowerCase();
    const deviceId = cleanText(input.deviceId, 120);
    const suffix = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    if (action === "play") {
      const uri = cleanText(input.uri, 240);
      return this.api(`/me/player/play${suffix}`, { method: "PUT", ...(uri ? { body: JSON.stringify({ uris: [uri] }) } : {}) });
    }
    if (action === "pause") return this.api(`/me/player/pause${suffix}`, { method: "PUT" });
    if (action === "next") return this.api(`/me/player/next${suffix}`, { method: "POST" });
    if (action === "previous") return this.api(`/me/player/previous${suffix}`, { method: "POST" });
    if (action === "volume") {
      const volume = Math.max(0, Math.min(100, Math.round(Number(input.volume))));
      if (!Number.isFinite(volume)) throw new Error("音量必须是 0 到 100");
      const separator = suffix ? "&" : "?";
      return this.api(`/me/player/volume${suffix}${separator}volume_percent=${volume}`, { method: "PUT" });
    }
    if (action === "queue") {
      const uri = cleanText(input.uri, 240);
      if (!uri) throw new Error("加入队列需要歌曲 URI");
      const separator = suffix ? "&" : "?";
      return this.api(`/me/player/queue${suffix}${separator}uri=${encodeURIComponent(uri)}`, { method: "POST" });
    }
    throw new Error("不支持的 Spotify 操作");
  }
}
