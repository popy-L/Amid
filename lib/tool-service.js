import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SpotifyService } from "./spotify-service.js";

const WEATHER_SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MCP_CACHE_MS = 5 * 60 * 1000;

const WEATHER_CODES = {
  0: "晴朗",
  1: "大致晴朗",
  2: "局部多云",
  3: "阴天",
  45: "有雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "强毛毛雨",
  56: "轻微冻雨",
  57: "较强冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "轻微冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "小阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴强冰雹",
};

function defaultConfig() {
  return {
    version: 1,
    weather: { enabled: true, location: null },
    mcp: { enabled: true, servers: [] },
  };
}

function safeJsonFile(path, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function cleanCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("经纬度格式不正确");
  }
  return { latitude: lat, longitude: lon };
}

function weatherLocation(result) {
  if (!result) return null;
  const { latitude, longitude } = cleanCoordinates(result.latitude, result.longitude);
  return {
    id: result.id || "",
    name: cleanText(result.name || "当前位置", 80),
    admin1: cleanText(result.admin1, 80),
    country: cleanText(result.country, 80),
    countryCode: cleanText(result.country_code || result.countryCode, 8),
    timezone: cleanText(result.timezone || "auto", 80),
    latitude,
    longitude,
  };
}

function displayLocation(location) {
  return [location?.name, location?.admin1, location?.country].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" · ");
}

function safeMcpId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
}

function modelToolName(serverId, remoteName) {
  return `mcp_${safeMcpId(serverId)}_${String(remoteName || "tool").replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
}

function expandHome(path) {
  const value = cleanText(path, 500);
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled !== false,
    trustMode: server.trustMode || "read-only",
    url: server.url || "",
    authConfigured: Boolean(server.authToken),
    command: server.command || "",
    args: Array.isArray(server.args) ? server.args : [],
    cwd: server.cwd || "",
  };
}

async function fetchJson(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: options.signal || controller.signal, headers: { accept: "application/json", ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.reason || payload.error || `接口返回 ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export class ToolService {
  constructor(dataDir, { historyService = null, supabaseService = null } = {}) {
    this.dataDir = resolve(dataDir);
    this.historyService = historyService;
    this.supabaseService = supabaseService;
    this.configFile = join(this.dataDir, "tools.json");
    this.config = this.load();
    this.spotify = new SpotifyService(this.dataDir);
    this.mcpCache = { at: 0, tools: [], diagnostics: [] };
  }

  load() {
    const defaults = defaultConfig();
    const stored = safeJsonFile(this.configFile, defaults);
    return {
      version: 1,
      weather: { ...defaults.weather, ...(stored.weather || {}) },
      mcp: {
        ...defaults.mcp,
        ...(stored.mcp || {}),
        servers: Array.isArray(stored.mcp?.servers) ? stored.mcp.servers : [],
      },
    };
  }

  save() {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), "utf8");
    this.mcpCache = { at: 0, tools: [], diagnostics: [] };
  }

  publicConfig() {
    return {
      weather: {
        enabled: this.config.weather.enabled !== false,
        location: this.config.weather.location,
        locationLabel: displayLocation(this.config.weather.location),
      },
      mcp: {
        enabled: this.config.mcp.enabled !== false,
        servers: this.config.mcp.servers.map(publicServer),
      },
      spotify: this.spotify.publicConfig(),
    };
  }

  spotifyPublicConfig(redirectUri = "") {
    return this.spotify.publicConfig(redirectUri);
  }

  setSpotifyConfig(input) {
    return this.spotify.setConfig(input);
  }

  disconnectSpotify() {
    this.spotify.disconnect();
  }

  createSpotifyAuthorization(input) {
    return this.spotify.createAuthorization(input);
  }

  completeSpotifyAuthorization(input) {
    return this.spotify.completeAuthorization(input);
  }

  async searchWeatherLocations(query) {
    const name = cleanText(query, 100);
    if (name.length < 2) throw new Error("至少输入两个字的城市名");
    const url = new URL(WEATHER_SEARCH_URL);
    url.searchParams.set("name", name);
    url.searchParams.set("count", "8");
    url.searchParams.set("language", "zh");
    url.searchParams.set("format", "json");
    const payload = await fetchJson(url);
    return (payload.results || []).map(weatherLocation).filter(Boolean);
  }

  setWeatherLocation(input) {
    const location = weatherLocation(input);
    if (!location) throw new Error("没有收到位置");
    this.config.weather.location = location;
    this.config.weather.enabled = true;
    this.save();
    return location;
  }

  setWeatherEnabled(enabled) {
    this.config.weather.enabled = enabled !== false;
    this.save();
  }

  async resolveWeatherLocation(input = {}) {
    const named = cleanText(input.location || input.city, 100);
    if (named) {
      const matches = await this.searchWeatherLocations(named);
      if (!matches.length) throw new Error(`没有找到“${named}”`);
      return matches[0];
    }
    if (input.latitude !== undefined || input.longitude !== undefined) {
      const coords = cleanCoordinates(input.latitude, input.longitude);
      return weatherLocation({ ...coords, name: input.name || "当前位置", timezone: input.timezone || "auto" });
    }
    if (!this.config.weather.location) throw new Error("还没有设置天气位置");
    return this.config.weather.location;
  }

  async currentWeather(input = {}) {
    const location = await this.resolveWeatherLocation(input);
    const url = new URL(WEATHER_FORECAST_URL);
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("timezone", location.timezone || "auto");
    url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset");
    url.searchParams.set("forecast_days", "2");
    const payload = await fetchJson(url);
    const current = payload.current || {};
    const code = Number(current.weather_code);
    return {
      source: "Open-Meteo",
      fetchedAt: new Date().toISOString(),
      location: { ...location, label: displayLocation(location) || location.name },
      current: {
        time: current.time || "",
        temperature: Number(current.temperature_2m),
        apparentTemperature: Number(current.apparent_temperature),
        relativeHumidity: Number(current.relative_humidity_2m),
        precipitation: Number(current.precipitation),
        cloudCover: Number(current.cloud_cover),
        windSpeed: Number(current.wind_speed_10m),
        isDay: Number(current.is_day) === 1,
        weatherCode: Number.isFinite(code) ? code : null,
        condition: WEATHER_CODES[code] || "天气状况未知",
      },
      today: {
        maxTemperature: Number(payload.daily?.temperature_2m_max?.[0]),
        minTemperature: Number(payload.daily?.temperature_2m_min?.[0]),
        precipitationProbability: Number(payload.daily?.precipitation_probability_max?.[0]),
        sunrise: payload.daily?.sunrise?.[0] || "",
        sunset: payload.daily?.sunset?.[0] || "",
      },
      units: {
        temperature: payload.current_units?.temperature_2m || "°C",
        windSpeed: payload.current_units?.wind_speed_10m || "km/h",
        precipitation: payload.current_units?.precipitation || "mm",
      },
    };
  }

  upsertMcpServer(input) {
    const requestedId = safeMcpId(input.id);
    const existing = requestedId ? this.config.mcp.servers.find((item) => item.id === requestedId) : null;
    const id = existing?.id || `server_${randomUUID().slice(0, 8)}`;
    const transport = input.transport === "stdio" ? "stdio" : "http";
    const server = {
      id,
      name: cleanText(input.name || "MCP Server", 60) || "MCP Server",
      transport,
      enabled: input.enabled !== false,
      trustMode: input.trustMode === "all" ? "all" : "read-only",
      authToken: cleanText(input.authToken, 2000) || existing?.authToken || "",
    };
    if (transport === "http") {
      const url = new URL(cleanText(input.url, 1000));
      const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("远程 MCP 必须使用 HTTPS；本机 localhost 可以使用 HTTP");
      server.url = url.toString();
    } else {
      server.command = cleanText(input.command, 500);
      if (!server.command) throw new Error("stdio MCP 需要填写启动命令");
      const args = Array.isArray(input.args) ? input.args : String(input.args || "").split(/\r?\n/);
      server.args = args.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 40);
      server.cwd = expandHome(input.cwd);
    }
    const index = this.config.mcp.servers.findIndex((item) => item.id === id);
    if (index >= 0) this.config.mcp.servers[index] = server;
    else this.config.mcp.servers.push(server);
    this.save();
    return publicServer(server);
  }

  deleteMcpServer(id) {
    const before = this.config.mcp.servers.length;
    this.config.mcp.servers = this.config.mcp.servers.filter((item) => item.id !== id);
    if (this.config.mcp.servers.length === before) throw new Error("MCP Server 不存在");
    this.save();
  }

  setMcpEnabled(enabled) {
    this.config.mcp.enabled = enabled !== false;
    this.save();
  }

  async connectMcpServer(server) {
    const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
    const client = new Client({ name: "amid", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
    let transport;
    if (server.transport === "stdio") {
      const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
      transport = new StdioClientTransport({ command: server.command, args: server.args || [], ...(server.cwd ? { cwd: server.cwd } : {}) });
    } else {
      const options = server.authToken ? { authProvider: { token: async () => server.authToken } } : {};
      transport = new StreamableHTTPClientTransport(new URL(server.url), options);
    }
    await client.connect(transport);
    return { client, transport };
  }

  toolAllowed(server, tool) {
    return server.trustMode === "all" || tool.annotations?.readOnlyHint === true;
  }

  async discoverMcpTools({ force = false } = {}) {
    if (this.config.mcp.enabled === false) return { tools: [], diagnostics: [] };
    if (!force && Date.now() - this.mcpCache.at < MCP_CACHE_MS) return this.mcpCache;
    const tools = [];
    const diagnostics = [];
    for (const server of this.config.mcp.servers.filter((item) => item.enabled !== false)) {
      let client;
      try {
        ({ client } = await this.connectMcpServer(server));
        let cursor;
        let count = 0;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools || []) {
            count += 1;
            if (!this.toolAllowed(server, tool)) continue;
            tools.push({
              name: modelToolName(server.id, tool.name),
              title: tool.title || tool.name,
              description: `[${server.name}] ${tool.description || tool.name}`,
              inputSchema: tool.inputSchema || { type: "object", properties: {} },
              annotations: tool.annotations || {},
              source: "mcp",
              serverId: server.id,
              remoteName: tool.name,
            });
          }
          cursor = page.nextCursor;
        } while (cursor);
        diagnostics.push({ serverId: server.id, name: server.name, ok: true, discovered: count, exposed: tools.filter((tool) => tool.serverId === server.id).length });
      } catch (error) {
        diagnostics.push({ serverId: server.id, name: server.name, ok: false, error: error.message || "连接失败" });
      } finally {
        await client?.close().catch(() => {});
      }
    }
    this.mcpCache = { at: Date.now(), tools, diagnostics };
    return this.mcpCache;
  }

  async listModelTools() {
    const tools = [];
    tools.push({
      name: "favorite_user_message",
      title: "收藏用户消息",
      description: "把用户当前会话中一条确实值得长期留住的原话加入收藏。只收藏用户说的话；仅在关系、约定、偏好、重要经历或独特表达有明显意义时使用，不要因礼貌或普通闲聊调用。调用本工具时，必须在同一轮工具调用之前先写完要正常发送给用户的完整回复；工具执行后本轮会立即结束，不会再让你读取工具结果或补写回复。exactQuote 须逐字复制一段连续原文；reason 用一句短话说明为什么想留下。",
      inputSchema: {
        type: "object",
        properties: {
          exactQuote: { type: "string", minLength: 2, maxLength: 180, description: "用户消息中的连续原文片段，必须逐字复制，不要改写或加引号。" },
          reason: { type: "string", maxLength: 100, description: "可选。为什么想收藏，简短一句即可。" },
        },
        required: ["exactQuote"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      source: "builtin",
    });
    if (this.historyService) {
      tools.push({
        name: "search_original_conversation",
        title: "查询原始对话记录",
        description: "优先从 Supabase 外置原始对话表，用日期或一到多个关键词定位少量锚点；外置不可用时回退本地。默认同时带回最佳锚点前后各 3 条实际消息，通常一次调用后即可回答，不要再重复调用展开工具。仅当自动带回的前后文仍缺少关键细节时，才用 expand_original_conversation 继续翻页。多个关键词按全部命中处理。旧记录没有文字/语音来源字段时必须标注来源未知。",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "可选。要查找的原话、关键词、人名或事件；支持空格分隔多个词。" },
            keywords: { type: "array", items: { type: "string" }, maxItems: 6, description: "可选。多个必须同时出现在同一条消息中的关键词，例如 [\"语轩\", \"电影\"]。" },
            startDate: { type: "string", description: "可选。开始日期，格式 YYYY-MM-DD（含当天）。" },
            endDate: { type: "string", description: "可选。结束日期，格式 YYYY-MM-DD（含当天）。" },
            speaker: { type: "string", enum: ["all", "user", "claude"], description: "发言人，默认 all。" },
            source: { type: "string", enum: ["all", "text", "voice", "voice_note", "voice_call", "assistant_voice"], description: "来源。voice 包括所有语音留言、语音通话与 Claude 语音消息。" },
            order: { type: "string", enum: ["desc", "asc"], description: "按时间倒序或正序，默认 desc。" },
            limit: { type: "integer", minimum: 1, maximum: 6, description: "最多返回多少个锚点，默认 2；通常不要超过 3。" },
            includeContext: { type: "boolean", description: "是否自动带回最佳锚点的相邻消息，默认 true。只有只想确认日期或是否出现过时才设为 false。" },
            contextBefore: { type: "integer", minimum: 0, maximum: 6, description: "自动带回最佳锚点前多少条实际消息，默认 3。" },
            contextAfter: { type: "integer", minimum: 0, maximum: 6, description: "自动带回最佳锚点后多少条实际消息，默认 3。" },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        source: "builtin",
      });
      tools.push({
        name: "expand_original_conversation",
        title: "展开原始对话前后文",
        description: "第二步：围绕已命中的消息 ID，读取相邻的少量原始消息，默认前后各 3 条。每条都带真实时间；相邻两句话即使间隔一小时也只取这两条，不扫描空白时间。若细节仍不足，按返回的 nextPage 游标继续向前或向后翻下一页，只返回尚未读过的消息。禁止直接读取整天。",
        inputSchema: {
          type: "object",
          properties: {
            messageId: { type: "string", description: "search_original_conversation 返回的消息 ID。" },
            before: { type: "integer", minimum: 0, maximum: 10, description: "向前取多少条实际消息，默认 3。" },
            after: { type: "integer", minimum: 0, maximum: 10, description: "向后取多少条实际消息，默认 3。" },
            beforeCursorId: { type: "string", description: "继续向前翻页时，填写上次结果最早一条消息的 ID；首次留空。" },
            afterCursorId: { type: "string", description: "继续向后翻页时，填写上次结果最晚一条消息的 ID；首次留空。" },
          },
          required: ["messageId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        source: "builtin",
      });
    }
    if (this.config.weather.enabled !== false) {
      tools.push({
        name: "get_weather",
        title: "获取天气",
        description: `查询当前天气、温度、体感温度和今天的最高最低温度。${this.config.weather.location ? `默认位置：${displayLocation(this.config.weather.location)}。` : "可以传入城市名；未传城市时使用用户设置的位置。"}`,
        inputSchema: {
          type: "object",
          properties: { location: { type: "string", description: "可选。城市、地区或邮编；留空使用用户设置的位置。" } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
        source: "builtin",
      });
    }
    const spotify = this.spotify.publicConfig();
    if (spotify.enabled !== false) {
      tools.push({
        name: "spotify_find_music",
        title: "在 Spotify 选歌",
        description: "根据歌曲名、歌手、心情或场景选择 Spotify 音乐。未连接账户时会返回一个可点击的 Spotify 搜索链接；连接后会返回真实曲目和 URI。调用后应说明选择理由，并把 openUrl 提供给用户。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "歌曲、歌手、语言、风格、心情或使用场景。" },
            limit: { type: "integer", minimum: 1, maximum: 8, description: "候选歌曲数量，默认 5。" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
        source: "builtin",
      });
      if (spotify.connected) {
        tools.push({
          name: "spotify_get_playback",
          title: "查看 Spotify 播放状态",
          description: "读取当前歌曲、播放进度和正在使用的 Spotify Connect 设备。",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, openWorldHint: true },
          source: "builtin",
        });
        tools.push({
          name: "spotify_list_devices",
          title: "查看 Spotify 设备",
          description: "列出当前账户可用的 Spotify Connect 播放设备。",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, openWorldHint: true },
          source: "builtin",
        });
      }
      if (spotify.controlAvailable) {
        tools.push({
          name: "spotify_control_playback",
          title: "控制 Spotify 播放",
          description: "在用户明确开启自动控制后播放、暂停、切歌、调整音量或加入队列。播放具体歌曲时先用 spotify_find_music 获取 URI。",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["play", "pause", "next", "previous", "volume", "queue"] },
              uri: { type: "string", description: "play 或 queue 时可用的 Spotify URI。" },
              deviceId: { type: "string", description: "可选的 Spotify Connect 设备 ID。" },
              volume: { type: "integer", minimum: 0, maximum: 100, description: "volume 操作时的音量百分比。" },
            },
            required: ["action"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
          source: "builtin",
        });
      }
    }
    const discovered = await this.discoverMcpTools();
    return [...tools, ...discovered.tools];
  }

  async executeTool(name, args = {}) {
    if (name === "favorite_user_message") {
      const exactQuote = cleanText(args.exactQuote, 180);
      if (exactQuote.length < 2) throw new Error("需要提供用户消息中的连续原文片段");
      return { accepted: true, exactQuote, reason: cleanText(args.reason, 100) };
    }
    if (name === "search_original_conversation") {
      const searchArgs = { ...args, limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 2 };
      let searchResult;
      if (this.supabaseService?.historyReady()) {
        try { searchResult = await this.supabaseService.searchHistory(searchArgs); }
        catch (error) {
          if (!this.historyService) throw error;
          searchResult = { ...this.historyService.search(searchArgs), fallbackFrom: "supabase", fallbackReason: error.message };
        }
      } else {
        if (!this.historyService) throw new Error("原始对话查询服务尚未连接");
        searchResult = this.historyService.search(searchArgs);
      }
      if (args.includeContext === false || !searchResult?.results?.length) return searchResult;
      const anchor = searchResult.results[0];
      const requestedBefore = Number(args.contextBefore);
      const requestedAfter = Number(args.contextAfter);
      const before = Math.max(0, Math.min(6, Number.isFinite(requestedBefore) ? requestedBefore : 3));
      const after = Math.max(0, Math.min(6, Number.isFinite(requestedAfter) ? requestedAfter : 3));
      try {
        const context = await this.executeTool("expand_original_conversation", { messageId: anchor.id, before, after });
        return { ...searchResult, contextIncluded: true, selectedAnchorId: anchor.id, context };
      } catch (error) {
        return { ...searchResult, contextIncluded: false, contextError: error.message || "无法自动读取相邻消息" };
      }
    }
    if (name === "expand_original_conversation") {
      if (this.supabaseService?.historyReady()) {
        try { return await this.supabaseService.expandHistory(args); }
        catch (error) {
          if (!this.historyService) throw error;
          try { return { ...this.historyService.context(args), fallbackFrom: "supabase", fallbackReason: error.message }; }
          catch { throw error; }
        }
      }
      if (!this.historyService) throw new Error("原始对话查询服务尚未连接");
      return this.historyService.context(args);
    }
    if (name === "send_voice_message") return { accepted: true, text: String(args.text || "") };
    if (name === "start_voice_call") return { accepted: true, openingLine: String(args.openingLine || "") };
    if (name === "get_weather") return this.currentWeather(args);
    if (name === "spotify_find_music") return this.spotify.findMusic(args);
    if (name === "spotify_get_playback") return this.spotify.playbackState();
    if (name === "spotify_list_devices") return this.spotify.devices();
    if (name === "spotify_control_playback") return this.spotify.control(args);
    const discovered = await this.discoverMcpTools();
    const tool = discovered.tools.find((item) => item.name === name);
    if (!tool) throw new Error("工具不存在或尚未获准使用");
    const server = this.config.mcp.servers.find((item) => item.id === tool.serverId && item.enabled !== false);
    if (!server) throw new Error("对应的 MCP Server 已停用");
    let client;
    try {
      ({ client } = await this.connectMcpServer(server));
      const result = await client.callTool({ name: tool.remoteName, arguments: args });
      return {
        server: server.name,
        tool: tool.remoteName,
        isError: result.isError === true,
        content: result.content || [],
        structuredContent: result.structuredContent || null,
      };
    } finally {
      await client?.close().catch(() => {});
    }
  }
}
