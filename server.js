import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ToolService } from "./lib/tool-service.js";
import { HistoryService } from "./lib/history-service.js";
import { SupabaseService } from "./lib/supabase-service.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(ROOT, "public");

function readDotEnvValues() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  return values;
}

function loadDotEnv() {
  const values = readDotEnvValues();
  Object.entries(values).forEach(([key, value]) => { if (process.env[key] === undefined) process.env[key] = value; });
}

loadDotEnv();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ACCESS_TOKEN = String(process.env.AMID_ACCESS_TOKEN || "").trim();

const config = {
  baseUrl: process.env.LLM_BASE_URL || "",
  apiKey: process.env.LLM_API_KEY || "",
  model: process.env.LLM_MODEL || "",
  protocol: (process.env.LLM_PROTOCOL || "openai").toLowerCase(),
  elevenLabs: {
    baseUrl: (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1").replace(/\/$/, ""),
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
    sttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
    ttsModel: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
  },
};

const PRIVATE_DATA_DIR = resolve(process.env.AMID_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(ROOT, ".data"));
const PROVIDERS_FILE = join(PRIVATE_DATA_DIR, "providers.json");
const VOICE_CONFIG_FILE = join(PRIVATE_DATA_DIR, "voice.json");
const historyService = new HistoryService(PRIVATE_DATA_DIR);
const supabaseService = new SupabaseService(PRIVATE_DATA_DIR);
const toolService = new ToolService(PRIVATE_DATA_DIR, { historyService, supabaseService });

function environmentProvider() {
  return {
    id: "env",
    name: "现有中转站",
    preset: "environment",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    protocol: config.protocol,
    readOnly: true,
  };
}

function loadProviderStore() {
  try {
    const parsed = JSON.parse(readFileSync(PROVIDERS_FILE, "utf8"));
    if (parsed && Array.isArray(parsed.providers)) return { activeId: String(parsed.activeId || "env"), providers: parsed.providers };
  } catch {}
  return { activeId: "env", providers: [] };
}

const providerStore = loadProviderStore();

function loadVoiceStore() {
  try {
    const parsed = JSON.parse(readFileSync(VOICE_CONFIG_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

let voiceStore = loadVoiceStore();

function saveVoiceStore() {
  mkdirSync(PRIVATE_DATA_DIR, { recursive: true });
  writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(voiceStore, null, 2), "utf8");
}

function isVoiceServiceProvider(provider) {
  return Boolean(provider && /elevenlabs/i.test(`${provider.name || ""} ${provider.baseUrl || ""}`));
}

function elevenLabsProviderFallback() {
  return providerStore.providers.find(isVoiceServiceProvider) || null;
}

function normalizeElevenLabsBaseUrl(value) {
  const raw = String(value || "https://api.elevenlabs.io/v1").trim().replace(/\/$/, "");
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return "https://api.elevenlabs.io/v1";
    if (parsed.hostname === "api.elevenlabs.io" && (!parsed.pathname || parsed.pathname === "/")) return `${raw}/v1`;
    return raw;
  } catch {
    return "https://api.elevenlabs.io/v1";
  }
}

function effectiveElevenLabsConfig() {
  const fallbackProvider = elevenLabsProviderFallback();
  const storedKey = String(voiceStore.apiKey || "").trim();
  const environmentKey = String(config.elevenLabs.apiKey || "").trim();
  const providerKey = String(fallbackProvider?.apiKey || "").trim();
  const keySource = storedKey ? "voice" : environmentKey ? "environment" : providerKey ? "provider" : "none";
  const apiKey = storedKey || environmentKey || providerKey;
  const baseUrl = normalizeElevenLabsBaseUrl(
    voiceStore.baseUrl || (keySource === "provider" ? fallbackProvider?.baseUrl : "") || config.elevenLabs.baseUrl,
  );
  return {
    baseUrl,
    apiKey,
    voiceId: Object.hasOwn(voiceStore, "voiceId") ? String(voiceStore.voiceId || "").trim() : config.elevenLabs.voiceId,
    voiceName: String(voiceStore.voiceName || "").trim(),
    sttModel: String(voiceStore.sttModel || config.elevenLabs.sttModel || "scribe_v2").trim(),
    messageTtsModel: String(voiceStore.messageTtsModel || voiceStore.ttsModel || "eleven_v3").trim(),
    callTtsModel: String(voiceStore.callTtsModel || "eleven_flash_v2_5").trim(),
    keySource,
    sourceProviderId: keySource === "provider" ? fallbackProvider?.id || "" : "",
    sourceProviderName: keySource === "provider" ? fallbackProvider?.name || "" : "",
  };
}

function publicVoiceConfig() {
  const voice = effectiveElevenLabsConfig();
  return {
    provider: "elevenlabs",
    configured: Boolean(voice.apiKey && voice.voiceId),
    apiKeyConfigured: Boolean(voice.apiKey),
    voiceId: voice.voiceId,
    voiceIdConfigured: Boolean(voice.voiceId),
    voiceName: voice.voiceName,
    baseUrl: voice.baseUrl,
    sttModel: voice.sttModel,
    ttsModel: voice.callTtsModel,
    messageTtsModel: voice.messageTtsModel,
    callTtsModel: voice.callTtsModel,
    keySource: voice.keySource,
    sourceProviderId: voice.sourceProviderId,
    sourceProviderName: voice.sourceProviderName,
  };
}

function reloadProviderConfiguration() {
  const values = readDotEnvValues();
  const value = (key, fallback = "") => Object.hasOwn(values, key) ? values[key] : process.env[key] ?? fallback;
  config.baseUrl = value("LLM_BASE_URL");
  config.apiKey = value("LLM_API_KEY");
  config.model = value("LLM_MODEL");
  config.protocol = value("LLM_PROTOCOL", "openai").toLowerCase();
  config.elevenLabs.baseUrl = value("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1").replace(/\/$/, "");
  config.elevenLabs.apiKey = value("ELEVENLABS_API_KEY");
  config.elevenLabs.voiceId = value("ELEVENLABS_VOICE_ID");
  config.elevenLabs.sttModel = value("ELEVENLABS_STT_MODEL", "scribe_v2");
  config.elevenLabs.ttsModel = value("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5");
  const stored = loadProviderStore();
  providerStore.activeId = stored.activeId;
  providerStore.providers = stored.providers;
  voiceStore = loadVoiceStore();
}

function saveProviderStore() {
  mkdirSync(PRIVATE_DATA_DIR, { recursive: true });
  writeFileSync(PROVIDERS_FILE, JSON.stringify(providerStore, null, 2), "utf8");
}

function providerById(id) {
  if (!id || id === "env") return environmentProvider();
  return providerStore.providers.find((provider) => provider.id === id) || null;
}

function activeProvider() {
  const provider = providerById(providerStore.activeId);
  return provider && !isVoiceServiceProvider(provider) ? provider : environmentProvider();
}

function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    preset: provider.preset || "custom",
    baseUrl: provider.baseUrl || "",
    model: provider.model || "",
    protocol: provider.protocol || "openai",
    credentialsConfigured: Boolean(provider.baseUrl && provider.apiKey),
    readOnly: provider.readOnly === true,
    purpose: isVoiceServiceProvider(provider) ? "voice" : "llm",
  };
}

function cleanProviderUrl(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("服务商地址必须使用 http 或 https");
  return raw;
}

function cleanProviderProtocol(value) {
  return String(value || "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
}

async function handleProviderUpsert(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (error) { return json(res, 400, { error: error.message || "无法解析服务商配置" }); }
  const requestedId = String(payload.id || "").trim();
  if (requestedId === "env") return json(res, 400, { error: "环境变量服务商不能在页面中改写" });
  const existing = requestedId ? providerStore.providers.find((provider) => provider.id === requestedId) : null;
  const id = existing?.id || `provider-${randomUUID().slice(0, 8)}`;
  const name = String(payload.name || "自定义服务商").trim().slice(0, 40) || "自定义服务商";
  let baseUrl;
  try { baseUrl = cleanProviderUrl(payload.baseUrl); } catch (error) { return json(res, 400, { error: error.message }); }
  const apiKey = String(payload.apiKey || "").trim() || existing?.apiKey || "";
  const provider = {
    id,
    name,
    preset: ["openai", "anthropic", "custom"].includes(payload.preset) ? payload.preset : "custom",
    baseUrl,
    apiKey,
    model: requestedModel(payload.model),
    protocol: cleanProviderProtocol(payload.protocol),
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, provider);
  else providerStore.providers.push(provider);
  // Saving a provider must not silently change the app-wide default. The
  // dedicated activation endpoint is the only place that switches defaults.
  if (payload.activate === true) providerStore.activeId = id;
  saveProviderStore();
  return json(res, 200, { provider: publicProvider(provider), activeId: providerStore.activeId });
}

async function handleProviderActivation(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (error) { return json(res, 400, { error: error.message || "无法解析服务商选择" }); }
  const provider = providerById(String(payload.id || ""));
  if (!provider) return json(res, 404, { error: "服务商不存在" });
  if (isVoiceServiceProvider(provider)) return json(res, 400, { error: "ElevenLabs 是语音服务，请在语音配置中管理，不能设为聊天模型服务商" });
  providerStore.activeId = provider.id;
  saveProviderStore();
  return json(res, 200, { activeId: provider.id, provider: publicProvider(provider) });
}

async function handleProviderDelete(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (error) { return json(res, 400, { error: error.message || "无法解析删除请求" }); }
  const id = String(payload.id || "");
  if (!id || id === "env") return json(res, 400, { error: "不能删除环境变量服务商" });
  const before = providerStore.providers.length;
  providerStore.providers = providerStore.providers.filter((provider) => provider.id !== id);
  if (providerStore.providers.length === before) return json(res, 404, { error: "服务商不存在" });
  if (providerStore.activeId === id) providerStore.activeId = "env";
  saveProviderStore();
  return json(res, 200, { activeId: providerStore.activeId });
}

function isLoopbackRequest(req) {
  const address = String(req.socket.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function requestAccessToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || req.headers["x-amid-access-token"] || "").trim();
}

function isAuthorizedRequest(req) {
  if (!ACCESS_TOKEN) return true;
  const received = Buffer.from(requestAccessToken(req));
  const expected = Buffer.from(ACCESS_TOKEN);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function handleOpenProviderConfig(req, res) {
  if (!isLoopbackRequest(req)) return json(res, 403, { error: "配置文件只能在运行此间的本机上编辑" });
  return json(res, 410, { error: "此入口已改为页面内编辑配置文件" });
}

function providerConfigFile(kind) {
  if (kind === "providers") {
    if (!existsSync(PROVIDERS_FILE)) saveProviderStore();
    return { kind, file: ".data/providers.json", path: PROVIDERS_FILE };
  }
  if (kind === "env") return { kind, file: ".env", path: join(ROOT, ".env") };
  throw new Error("未知的配置文件");
}

async function handleReadProviderConfigFile(req, res) {
  if (!isLoopbackRequest(req)) return json(res, 403, { error: "配置文件只能在运行此间的本机上编辑" });
  try {
    const url = new URL(req.url, "http://localhost");
    const configFile = providerConfigFile(url.searchParams.get("kind"));
    const contents = existsSync(configFile.path) ? readFileSync(configFile.path, "utf8") : "";
    return json(res, 200, { kind: configFile.kind, file: configFile.file, contents });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法读取配置文件" });
  }
}

async function handleSaveProviderConfigFile(req, res) {
  if (!isLoopbackRequest(req)) return json(res, 403, { error: "配置文件只能在运行此间的本机上编辑" });
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (error) { return json(res, 400, { error: error.message || "无法解析配置文件" }); }
  try {
    const configFile = providerConfigFile(payload.kind);
    const contents = typeof payload.contents === "string" ? payload.contents : "";
    if (contents.length > 256_000) return json(res, 400, { error: "配置文件过大" });
    if (configFile.kind === "providers") {
      const parsed = JSON.parse(contents || "{}");
      if (!parsed || !Array.isArray(parsed.providers)) throw new Error("providers.json 需要包含 providers 数组");
    }
    if (configFile.kind === "providers") mkdirSync(PRIVATE_DATA_DIR, { recursive: true });
    writeFileSync(configFile.path, contents, "utf8");
    reloadProviderConfiguration();
    return json(res, 200, { saved: true, file: configFile.file, activeId: activeProvider().id });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存配置文件" });
  }
}

async function handleReloadProviderConfig(req, res) {
  if (!isLoopbackRequest(req)) return json(res, 403, { error: "配置文件只能在运行此间的本机上重新载入" });
  try {
    reloadProviderConfiguration();
    return json(res, 200, { reloaded: true, activeId: activeProvider().id });
  } catch (error) {
    return json(res, 500, { error: error.message || "配置文件读取失败" });
  }
}

async function readJsonRequest(req, fallbackMessage = "无法解析请求") {
  try {
    return JSON.parse(await readBody(req));
  } catch (error) {
    throw new Error(error.message || fallbackMessage);
  }
}

function requireLoopbackTools(req, res) {
  if (isLoopbackRequest(req)) return true;
  json(res, 403, { error: "工具与 MCP 配置只能在运行此间的本机上修改" });
  return false;
}

function spotifyRedirectUri(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = String(req.headers.host || `localhost:${PORT}`).trim();
  const hostname = host.replace(/^\[/, "").replace(/\].*$/, "").replace(/:\d+$/, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    const port = host.match(/:(\d+)$/)?.[1] || String(PORT);
    return `http://127.0.0.1:${port}/api/tools/spotify/callback`;
  }
  return `${forwardedProto || "https"}://${host}/api/tools/spotify/callback`;
}

function spotifyDefaultReturnTo() {
  return `http://localhost:${PORT}/?spotify=connected`;
}

function safeSpotifyReturnTo(req, value) {
  try {
    const target = new URL(String(value || ""));
    const requestHost = String(req.headers.host || "").toLowerCase();
    const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname.toLowerCase());
    if (local || target.host.toLowerCase() === requestHost) return target.toString();
  } catch {
    // Fall back to the local PWA origin.
  }
  return spotifyDefaultReturnTo();
}

function toolsPublicConfig(req) {
  const value = toolService.publicConfig();
  value.spotify = toolService.spotifyPublicConfig(spotifyRedirectUri(req));
  return value;
}

async function handleModelToolDefinitions(req, res) {
  try {
    const tools = [...voiceOutputToolDefinitions(), ...await toolService.listModelTools()];
    return json(res, 200, {
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.title || tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || { type: "object", properties: {} },
        annotations: tool.annotations || {},
        source: tool.source || "builtin",
        serverName: tool.serverName || "",
      })),
      generatedAt: new Date().toISOString(),
      note: "这里返回的就是当前聊天请求发送给模型的工具定义；不包含密钥，也不执行任何工具。",
    });
  } catch (error) {
    return json(res, 500, { error: error.message || "无法读取工具使用规范" });
  }
}

function voiceOutputToolDefinitions({ message = true, call = true } = {}) {
  const tools = [];
  if (message) tools.push({
    name: "send_voice_message",
    title: "发送语音消息",
    description: "可选输出工具。仅当这一条回复更适合用声音表达时调用。把要对用户说的完整原文放在 text 中；调用后不要再重复发送相同正文。",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "需要合成语音并保存在语音条中的完整原文。" } }, required: ["text"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false },
    source: "builtin",
  });
  if (call) tools.push({
    name: "start_voice_call",
    title: "发起语音通话",
    description: "可选来电工具。仅当确实希望与用户实时语音交谈时调用。不要另写来电理由；想说的内容放在 openingLine，等用户接听后直接说。openingLine 必须以 Claude 自己的第一人称直接对用户说话，使用‘我/你’，不要用第三人称描述 Claude 或用户。",
    inputSchema: { type: "object", properties: { openingLine: { type: "string", description: "用户接听后，Claude 以第一人称直接对用户说的第一句话。" } }, required: ["openingLine"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false },
    source: "builtin",
  });
  return tools;
}

async function handleSpotifyConfigUpdate(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    toolService.setSpotifyConfig(payload);
    return json(res, 200, toolsPublicConfig(req));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存 Spotify 设置" });
  }
}

async function handleSpotifyAuthorization(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const redirectUri = spotifyRedirectUri(req);
    const returnTo = safeSpotifyReturnTo(req, requestUrl.searchParams.get("returnTo"));
    return json(res, 200, toolService.createSpotifyAuthorization({ redirectUri, returnTo }));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法开始 Spotify 授权" });
  }
}

async function handleSpotifyCallback(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  const defaultReturnTo = spotifyDefaultReturnTo();
  if (requestUrl.searchParams.get("error")) {
    const target = new URL(defaultReturnTo);
    target.searchParams.set("spotify", "error");
    target.searchParams.set("message", requestUrl.searchParams.get("error") || "access_denied");
    res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    return res.end();
  }
  try {
    const result = await toolService.completeSpotifyAuthorization({
      code: requestUrl.searchParams.get("code") || "",
      state: requestUrl.searchParams.get("state") || "",
      redirectUri: spotifyRedirectUri(req),
    });
    const target = new URL(result.returnTo || defaultReturnTo);
    target.searchParams.set("spotify", "connected");
    res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    return res.end();
  } catch (error) {
    const target = new URL(defaultReturnTo);
    target.searchParams.set("spotify", "error");
    target.searchParams.set("message", error.message || "授权失败");
    res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    return res.end();
  }
}

async function handleSpotifyDisconnect(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  toolService.disconnectSpotify();
  return json(res, 200, toolsPublicConfig(req));
}

async function handleSpotifyFind(req, res) {
  try {
    const payload = await readJsonRequest(req);
    return json(res, 200, await toolService.executeTool("spotify_find_music", payload));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法搜索 Spotify 音乐" });
  }
}

async function handleSpotifyPlayback(req, res) {
  try {
    return json(res, 200, await toolService.executeTool("spotify_get_playback", {}));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法读取 Spotify 播放状态" });
  }
}

async function handleSpotifyControl(req, res) {
  try {
    const payload = await readJsonRequest(req);
    return json(res, 200, await toolService.executeTool("spotify_control_playback", payload));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法控制 Spotify 播放" });
  }
}

async function handleWeatherSearch(req, res) {
  try {
    const query = new URL(req.url, "http://localhost").searchParams.get("q") || "";
    return json(res, 200, { locations: await toolService.searchWeatherLocations(query) });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法搜索城市" });
  }
}

async function handleCurrentWeather(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const input = {};
    if (url.searchParams.get("location")) input.location = url.searchParams.get("location");
    if (url.searchParams.has("latitude")) input.latitude = url.searchParams.get("latitude");
    if (url.searchParams.has("longitude")) input.longitude = url.searchParams.get("longitude");
    if (url.searchParams.get("name")) input.name = url.searchParams.get("name");
    return json(res, 200, await toolService.currentWeather(input));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法获取天气" });
  }
}

async function handleWeatherLocationUpdate(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    return json(res, 200, { location: toolService.setWeatherLocation(payload), config: toolService.publicConfig() });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存天气位置" });
  }
}

async function handleWeatherEnabledUpdate(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    toolService.setWeatherEnabled(payload.enabled !== false);
    return json(res, 200, toolService.publicConfig());
  } catch (error) {
    return json(res, 400, { error: error.message || "无法修改天气工具" });
  }
}

async function handleMcpServerUpsert(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    return json(res, 200, { server: toolService.upsertMcpServer(payload), config: toolService.publicConfig() });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存 MCP Server" });
  }
}

async function handleMcpServerDelete(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    toolService.deleteMcpServer(String(payload.id || ""));
    return json(res, 200, toolService.publicConfig());
  } catch (error) {
    return json(res, 400, { error: error.message || "无法删除 MCP Server" });
  }
}

async function handleMcpEnabledUpdate(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const payload = await readJsonRequest(req);
    toolService.setMcpEnabled(payload.enabled !== false);
    return json(res, 200, toolService.publicConfig());
  } catch (error) {
    return json(res, 400, { error: error.message || "无法修改 MCP 设置" });
  }
}

async function handleMcpDiscovery(req, res) {
  if (!requireLoopbackTools(req, res)) return;
  try {
    const result = await toolService.discoverMcpTools({ force: true });
    return json(res, 200, {
      tools: result.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, serverId: tool.serverId, remoteName: tool.remoteName, annotations: tool.annotations })),
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    return json(res, 502, { error: error.message || "MCP 工具发现失败" });
  }
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".otf": "font/otf",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function readBinaryBody(req, maxBytes = 20_000_000) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        reject(new Error("录音文件过大"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!rejected) resolveBody(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function elevenLabsReady({ requireVoice = false } = {}) {
  const voice = effectiveElevenLabsConfig();
  return Boolean(voice.apiKey && (!requireVoice || voice.voiceId));
}

function cleanVoiceIdentifier(value) {
  const voiceId = String(value || "").trim();
  if (voiceId && !/^[a-zA-Z0-9_-]{3,120}$/.test(voiceId)) throw new Error("Voice ID 格式不正确");
  return voiceId;
}

function cleanVoiceModel(value, fallback) {
  const model = String(value || fallback).trim();
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(model)) throw new Error("语音模型名称格式不正确");
  return model;
}

async function handleVoiceConfigUpdate(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (error) { return json(res, 400, { error: error.message || "无法解析语音配置" }); }
  try {
    if (payload.apiKey && !isLoopbackRequest(req)) return json(res, 403, { error: "语音密钥只能在运行此间的本机上修改" });
    const next = { ...voiceStore };
    if (typeof payload.apiKey === "string" && payload.apiKey.trim()) next.apiKey = payload.apiKey.trim();
    if (payload.clearApiKey === true) next.apiKey = "";
    if (typeof payload.baseUrl === "string") next.baseUrl = normalizeElevenLabsBaseUrl(payload.baseUrl);
    if (typeof payload.voiceId === "string") next.voiceId = cleanVoiceIdentifier(payload.voiceId);
    if (typeof payload.voiceName === "string") next.voiceName = payload.voiceName.trim().slice(0, 100);
    if (typeof payload.sttModel === "string") next.sttModel = cleanVoiceModel(payload.sttModel, "scribe_v2");
    if (typeof payload.messageTtsModel === "string") next.messageTtsModel = cleanVoiceModel(payload.messageTtsModel, "eleven_v3");
    if (typeof payload.callTtsModel === "string") next.callTtsModel = cleanVoiceModel(payload.callTtsModel, "eleven_flash_v2_5");
    if (typeof payload.ttsModel === "string" && typeof payload.callTtsModel !== "string") next.callTtsModel = cleanVoiceModel(payload.ttsModel, "eleven_flash_v2_5");
    next.updatedAt = new Date().toISOString();
    voiceStore = next;
    saveVoiceStore();
    return json(res, 200, { saved: true, config: publicVoiceConfig() });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存语音配置" });
  }
}

function upstreamErrorDetail(payload) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail.slice(0, 220);
  if (detail && typeof detail === "object") return String(detail.message || detail.status || "").slice(0, 220);
  return String(payload?.message || "").slice(0, 220);
}

async function probeElevenLabs(path, options = {}) {
  const voice = effectiveElevenLabsConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${voice.baseUrl}${path}`, {
      ...options,
      headers: { "xi-api-key": voice.apiKey, ...(options.headers || {}) },
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch {}
    return { status: response.status, ok: response.ok, payload, detail: upstreamErrorDetail(payload) };
  } catch (error) {
    return { status: 0, ok: false, payload: {}, detail: error.name === "AbortError" ? "请求超时" : "无法连接 ElevenLabs" };
  } finally {
    clearTimeout(timer);
  }
}

function permissionSummary(result, { validationProbe = false } = {}) {
  if (result.ok) return { state: "allowed", detail: "可用" };
  if (validationProbe && [400, 404, 405, 422].includes(result.status)) {
    return { state: "allowed", detail: "权限校验通过，未生成内容" };
  }
  if (result.status === 401) return { state: "invalid", detail: result.detail || "密钥无效" };
  if (result.status === 403) return { state: "denied", detail: result.detail || "密钥未授予此权限" };
  return { state: "unknown", detail: result.detail || `无法确认（HTTP ${result.status || "-"}）` };
}

async function handleVoiceCatalog(req, res) {
  const voice = effectiveElevenLabsConfig();
  if (!voice.apiKey) return json(res, 503, { error: "尚未配置 ElevenLabs API Key" });

  const sttProbeBody = new FormData();
  sttProbeBody.append("model_id", voice.sttModel);
  const [user, subscription, voices, models, ttsProbe, sttProbe] = await Promise.all([
    probeElevenLabs("/user"),
    probeElevenLabs("/user/subscription"),
    probeElevenLabs("/voices?show_legacy=true"),
    probeElevenLabs("/models"),
    probeElevenLabs("/text-to-speech/amid-permission-check", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: "", model_id: voice.callTtsModel }),
    }),
    probeElevenLabs("/speech-to-text", { method: "POST", body: sttProbeBody }),
  ]);

  const voiceItems = Array.isArray(voices.payload?.voices) ? voices.payload.voices : [];
  const modelItems = Array.isArray(models.payload) ? models.payload : [];
  const subscriptionData = subscription.ok ? subscription.payload : {};
  return json(res, 200, {
    checkedAt: new Date().toISOString(),
    keyValid: ![user, subscription, voices, models, ttsProbe, sttProbe].some((item) => item.status === 401),
    voices: voiceItems.map((item) => ({
      id: String(item.voice_id || ""),
      name: String(item.name || "未命名音色"),
      category: String(item.category || ""),
      description: String(item.description || item.labels?.description || item.labels?.use_case || ""),
      accent: String(item.labels?.accent || ""),
      gender: String(item.labels?.gender || ""),
      previewUrl: String(item.preview_url || ""),
    })).filter((item) => item.id),
    models: modelItems.map((item) => ({
      id: String(item.model_id || ""),
      name: String(item.name || item.model_id || ""),
      textToSpeech: item.can_do_text_to_speech === true,
      voiceConversion: item.can_do_voice_conversion === true,
    })).filter((item) => item.id),
    subscription: subscription.ok ? {
      tier: String(subscriptionData.tier || ""),
      status: String(subscriptionData.status || ""),
      characterCount: Number(subscriptionData.character_count || 0),
      characterLimit: Number(subscriptionData.character_limit || 0),
      nextResetUnix: Number(subscriptionData.next_character_count_reset_unix || 0),
    } : null,
    permissions: {
      account: permissionSummary(user),
      subscription: permissionSummary(subscription),
      voices: permissionSummary(voices),
      models: permissionSummary(models),
      textToSpeech: permissionSummary(ttsProbe, { validationProbe: true }),
      speechToText: permissionSummary(sttProbe, { validationProbe: true }),
    },
  });
}

async function handleVoiceValidation(req, res) {
  const voice = effectiveElevenLabsConfig();
  if (!voice.apiKey) return json(res, 503, { error: "尚未配置 ElevenLabs API Key" });
  const requestedVoiceId = new URL(req.url, "http://localhost").searchParams.get("voiceId");
  let voiceId;
  try { voiceId = requestedVoiceId ? cleanVoiceIdentifier(requestedVoiceId) : voice.voiceId; } catch (error) { return json(res, 400, { error: error.message || "Voice ID 格式不正确" }); }
  if (!voiceId) return json(res, 400, { error: "请先填写 Voice ID" });
  const result = await probeElevenLabs(`/voices/${encodeURIComponent(voiceId)}`);
  if (result.ok) {
    return json(res, 200, {
      available: true,
      voice: {
        id: String(result.payload.voice_id || voiceId),
        name: String(result.payload.name || "未命名音色"),
        category: String(result.payload.category || ""),
      },
    });
  }
  if (result.status === 404) return json(res, 404, { error: "当前 Voice ID 不在这把 ElevenLabs 密钥可用的音色列表里。请从“检测权限并获取音色”的账户列表中重新选择。" });
  if (result.status === 401) return json(res, 401, { error: "ElevenLabs API Key 无效或已失效" });
  if (result.status === 403) return json(res, 403, { error: `这把密钥没有读取该音色的权限${result.detail ? `：${result.detail}` : ""}` });
  return json(res, 502, { error: result.detail || `无法验证 Voice ID（HTTP ${result.status || "-"}）` });
}

function audioFileExtension(contentType) {
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

function demoReply(messages) {
  const latest = messages.at(-1)?.content || "这段时间";
  return `我在这里。你刚才说的是「${latest.slice(0, 80)}」。\n\n这是尚未配置中转站时的本地演示回复；接入真实 API 后，我会继续沿用此间的记忆和上下文。`;
}

function sendSseHeaders(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function normalizedApiBase(provider) {
  return String(provider?.baseUrl || "").trim().replace(/\/$/, "").replace(/\/(chat\/completions|messages)$/i, "");
}

function relayUrl(provider) {
  const base = normalizedApiBase(provider);
  if (provider.protocol === "anthropic") {
    return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  }
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function modelsUrl(provider) {
  const base = normalizedApiBase(provider);
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

function relayAuthHeaders(provider) {
  if (provider.protocol === "anthropic") {
    return { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" };
  }
  return { authorization: `Bearer ${provider.apiKey}` };
}

function normalizeModelList(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  return [...new Set(list.map((item) => typeof item === "string" ? item : item?.id || item?.name || item?.model).map(requestedModel).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

async function handleModels(req, res) {
  const providerId = new URL(req.url, "http://localhost").searchParams.get("provider");
  const requestedProvider = providerById(providerId);
  const provider = requestedProvider && !isVoiceServiceProvider(requestedProvider) ? requestedProvider : activeProvider();
  if (!provider.baseUrl || !provider.apiKey) return json(res, 400, { error: "请先配置服务商地址和密钥" });
  try {
    const upstream = await fetch(modelsUrl(provider), {
      headers: { accept: "application/json", ...relayAuthHeaders(provider) },
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`中转站模型接口返回 ${upstream.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
    }
    const models = normalizeModelList(await upstream.json());
    if (!models.length) throw new Error("中转站没有返回可识别的模型名称");
    return json(res, 200, { models });
  } catch (error) {
    return json(res, 502, { error: error.message || "无法获取模型列表" });
  }
}

function reasoningRequestOptions(model, enabled) {
  if (!enabled) return {};
  if (/claude/i.test(model)) {
    if (/claude-(?:opus|sonnet)-(?:4-[7-9]|[5-9])(?:\D|$)/i.test(model)) {
      return { thinking: { type: "adaptive" }, output_config: { effort: "medium" } };
    }
    return { thinking: { type: "enabled", budget_tokens: 2048 } };
  }
  return { reasoning_effort: "medium" };
}

function relayMessagesWithAttachments(messages, protocol) {
  return messages.map((message) => {
    if (!Array.isArray(message.attachments) || !message.attachments.length) return message;
    const textAttachments = message.attachments.filter((item) => item?.kind === "text" && typeof item.text === "string");
    const images = message.attachments.filter((item) => item?.kind === "image" && typeof item.dataUrl === "string" && /^data:image\//.test(item.dataUrl));
    const text = [String(message.content || ""), ...textAttachments.map((item) => `\n\n[附件：${String(item.name || "文本文件").slice(0, 120)}]\n${item.text.slice(0, 300_000)}`)].join("").trim();
    if (protocol === "anthropic") {
      const content = [];
      if (text) content.push({ type: "text", text });
      for (const image of images) {
        const match = image.dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
        if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
      }
      return { ...message, content, attachments: undefined };
    }
    const content = [];
    if (text) content.push({ type: "text", text });
    for (const image of images) content.push({ type: "image_url", image_url: { url: image.dataUrl } });
    return { ...message, content, attachments: undefined };
  });
}

function relayToolDefinitions(tools, protocol) {
  if (protocol === "anthropic") {
    return tools.map((tool) => ({ name: tool.name, description: tool.description || tool.title || tool.name, input_schema: tool.inputSchema || { type: "object", properties: {} } }));
  }
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description || tool.title || tool.name, parameters: tool.inputSchema || { type: "object", properties: {} } } }));
}

function buildRelayRequest(messages, model, returnReasoning = false, provider, tools = [], maxTokens = 0) {
  const outputLimit = maxTokens || (returnReasoning ? 4096 : 1200);
  const preparedMessages = relayMessagesWithAttachments(messages, provider.protocol);
  if (provider.protocol === "anthropic") {
    const system = preparedMessages.find((message) => message.role === "system")?.content;
    return {
      model,
      max_tokens: outputLimit,
      ...(system ? { system } : {}),
      messages: preparedMessages.filter((message) => message.role !== "system"),
      ...reasoningRequestOptions(model, returnReasoning),
      ...(tools.length ? { tools: relayToolDefinitions(tools, provider.protocol) } : {}),
      stream: true,
    };
  }
  return { model, messages: preparedMessages, stream: true, ...(maxTokens || returnReasoning ? { max_tokens: outputLimit } : {}), ...(!returnReasoning ? { temperature: 0.7 } : {}), ...reasoningRequestOptions(model, returnReasoning), ...(tools.length ? { tools: relayToolDefinitions(tools, provider.protocol), tool_choice: "auto" } : {}) };
}

function reasoningDeltaText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => reasoningDeltaText(item)).join("");
  if (value && typeof value === "object") return value.text || value.content || value.thinking || "";
  return "";
}

function toolCallArguments(call) {
  if (call.arguments && typeof call.arguments === "object") return call.arguments;
  const raw = String(call.argumentsText || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(`工具参数不是合法 JSON：${raw.slice(0, 180)}`);
  }
}

function compactToolResult(result, maxLength = 24_000) {
  let text;
  try { text = JSON.stringify(result); } catch { text = String(result); }
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…（工具结果已截断）`;
}

function compactOriginalRow(row, maxContent) {
  const content = String(row?.content || "").trim();
  const clipped = content.length > maxContent ? `${content.slice(0, maxContent)}…` : content;
  return {
    id: String(row?.id || ""),
    time: [row?.localDate, row?.localTime].filter(Boolean).join(" ") || String(row?.timestamp || ""),
    speaker: row?.speaker || "",
    source: row?.source || "historical_unknown",
    content: clipped,
  };
}

function compactOriginalToolResult(name, result, seenIds) {
  let omittedAlreadyRead = 0;
  const takeRows = (rows, maxContent) => (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const id = String(row?.id || "");
    if (id && seenIds.has(id)) {
      omittedAlreadyRead += 1;
      return [];
    }
    if (id) seenIds.add(id);
    return [compactOriginalRow(row, maxContent)];
  });

  if (name === "search_original_conversation") {
    const anchors = takeRows(result?.results, 420);
    const context = result?.context;
    const messages = takeRows(context?.results, 760);
    return compactToolResult({
      type: "original_conversation_recall",
      backend: result?.backend || "local",
      matched: Number(result?.matched) || anchors.length,
      anchors,
      selectedAnchorId: result?.selectedAnchorId || anchors[0]?.id || "",
      contextIncluded: result?.contextIncluded === true,
      context: context ? {
        messages,
        nextPage: context.nextPage || null,
      } : null,
      omittedAlreadyRead,
      contextError: result?.contextError || "",
      guidance: context
        ? "最佳锚点的相邻原文已自动附上。能据此回答时直接回答；只有缺少关键细节才继续展开。"
        : "这里只返回了锚点。需要具体前后文时再展开一次。",
    }, 9_000);
  }

  return compactToolResult({
    type: "original_conversation_context",
    backend: result?.backend || "local",
    anchorId: result?.messageId || "",
    messages: takeRows(result?.results, 760),
    nextPage: result?.nextPage || null,
    omittedAlreadyRead,
    guidance: "已省略本轮工具链中重复出现的原文。能回答时停止翻页；只有缺少关键细节才继续。",
  }, 8_000);
}

function toolResultSummary(result) {
  if (result?.backend && Array.isArray(result?.results) && result?.query) {
    return result.returned
      ? `在${result.backend === "supabase" ? " Supabase 外置" : "本地"}原始对话中找到 ${result.matched} 条，已返回 ${result.returned} 条${result.results.some((item) => ["voice_note", "voice_call", "assistant_voice"].includes(item.source)) ? "（含已标注的语音转写）" : ""}`
      : "原始对话中没有找到符合条件的记录";
  }
  if (result?.current && result?.location) {
    const unit = result.units?.temperature || "°C";
    return `${result.location.label || result.location.name} · ${result.current.condition} · ${result.current.temperature}${unit}，体感 ${result.current.apparentTemperature}${unit}`;
  }
  if (result?.isError) return `工具返回错误：${compactToolResult(result, 320)}`;
  if (result?.query && result?.openUrl) {
    const first = result.tracks?.[0];
    return first ? `找到《${first.name}》· ${first.artist || "Spotify"}` : `已生成“${result.query}”的 Spotify 打开链接`;
  }
  if (result?.track || Object.hasOwn(result || {}, "playing")) {
    return result.track ? `${result.playing ? "正在播放" : "已暂停"}《${result.track.name}》· ${result.track.artist || "Spotify"}` : "Spotify 当前没有播放内容";
  }
  if (result?.source === "local" && result?.selectedTrack) {
    return `已选择本地音乐《${result.selectedTrack.title}》· ${result.selectedTrack.artist || "本地音乐"}`;
  }
  return compactToolResult(result, 480);
}

function sanitizeLocalMusicIndex(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 300).flatMap((track) => {
    const id = String(track?.id || "").trim();
    const title = String(track?.title || "").trim().slice(0, 160);
    if (!/^[\w-]{1,100}$/u.test(id) || !title) return [];
    return [{ id, title, artist: String(track?.artist || "本地音乐").trim().slice(0, 120), duration: Math.max(0, Math.min(86400, Math.round(Number(track?.duration) || 0))) }];
  });
}

function localMusicToolDefinition(tracks) {
  const catalog = tracks.slice(0, 120).map((track) => `${track.id}: ${track.title} — ${track.artist || "本地音乐"}`).join("\n");
  return {
    name: "local_music_play",
    title: "播放本地音乐",
    description: `从用户设备内的本地曲库选择一首并请求浏览器播放。只能使用下列曲目 ID；音频文件本身不会提供给模型。调用本工具前先写完要给用户的简短回复；工具执行后本轮会立即结束，不会再次请求模型。\n${catalog}`,
    inputSchema: {
      type: "object",
      properties: { trackId: { type: "string", enum: tracks.slice(0, 120).map((track) => track.id), description: "要播放的本地曲目 ID。" } },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    source: "browser",
  };
}

function mergeUsage(total, usage) {
  total.model_rounds = (Number(total.model_rounds) || 0) + 1;
  if (!usage) return total;

  // Compatible relays do not agree on what `input_tokens` means. Some expose
  // OpenAI semantics (cached input already included), while others expose
  // Anthropic semantics (only uncached input, with cache reads alongside it).
  // Normalize both into the complete context processed by this model round.
  const claudeUsage = usage.billing_usage?.claude_usage || usage.claude_usage || {};
  const cacheRead = Math.max(
    Number(usage.cache_read_input_tokens) || 0,
    Number(usage.prompt_tokens_details?.cached_tokens) || 0,
    Number(claudeUsage.cache_read_input_tokens) || 0,
    Number(claudeUsage.claude_cache_read_input_tokens) || 0,
  );
  const cacheCreation = Math.max(
    Number(usage.cache_creation_input_tokens) || 0,
    Number(claudeUsage.cache_creation_input_tokens) || 0,
    (Number(claudeUsage.claude_cache_creation_5_m_tokens) || 0) + (Number(claudeUsage.claude_cache_creation_1_h_tokens) || 0),
  );
  const hasTopLevelAnthropicCache = usage.usage_semantic === "anthropic"
    || Object.hasOwn(usage, "cache_read_input_tokens")
    || Object.hasOwn(usage, "cache_creation_input_tokens");
  const topLevelAnthropicInput = hasTopLevelAnthropicCache
    ? (Number(usage.input_tokens) || 0) + cacheRead + cacheCreation
    : 0;
  const nestedAnthropicInput = Object.keys(claudeUsage).length
    ? (Number(claudeUsage.input_tokens) || 0) + cacheRead + cacheCreation
    : 0;
  const input = Math.max(
    Number(usage.input_tokens) || 0,
    Number(usage.prompt_tokens) || 0,
    topLevelAnthropicInput,
    nestedAnthropicInput,
  );
  const output = Math.max(
    Number(usage.output_tokens) || 0,
    Number(usage.completion_tokens) || 0,
    Number(claudeUsage.output_tokens) || 0,
  );
  const reportedTotal = Math.max(Number(usage.total_tokens) || 0, input + output);
  total.input_tokens += input;
  total.output_tokens += output;
  total.total_tokens += reportedTotal;
  total.cached_input_tokens = (Number(total.cached_input_tokens) || 0) + cacheRead;
  total.cache_creation_input_tokens = (Number(total.cache_creation_input_tokens) || 0) + cacheCreation;
  if (!Array.isArray(total.round_input_tokens)) total.round_input_tokens = [];
  total.round_input_tokens.push(input);
  return total;
}

function combineStreamUsage(current, next) {
  if (!next || typeof next !== "object") return current;
  if (!current) return { ...next };
  const merged = { ...current, ...next };
  for (const key of ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens"]) {
    if (current[key] !== undefined || next[key] !== undefined) merged[key] = Math.max(Number(current[key]) || 0, Number(next[key]) || 0);
  }
  if (current.prompt_tokens_details || next.prompt_tokens_details) merged.prompt_tokens_details = { ...(current.prompt_tokens_details || {}), ...(next.prompt_tokens_details || {}) };
  return merged;
}

function appendToolRound(messages, step, executed, protocol) {
  if (protocol === "anthropic") {
    const content = [];
    if (step.text) content.push({ type: "text", text: step.text });
    for (const item of executed) content.push({ type: "tool_use", id: item.call.id, name: item.call.name, input: item.args });
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: executed.map((item) => ({ type: "tool_result", tool_use_id: item.call.id, content: item.resultText, is_error: item.error })) });
    return;
  }
  messages.push({
    role: "assistant",
    content: step.text || null,
    tool_calls: executed.map((item) => ({ id: item.call.id, type: "function", function: { name: item.call.name, arguments: JSON.stringify(item.args) } })),
  });
  for (const item of executed) messages.push({ role: "tool", tool_call_id: item.call.id, content: item.resultText });
}

async function streamRelayOnce(messages, model, res, { returnReasoning = false, signal, provider, tools = [], maxTokens = 0 } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (provider.apiKey) Object.assign(headers, relayAuthHeaders(provider));

  const upstream = await fetch(relayUrl(provider), {
    method: "POST",
    headers,
    body: JSON.stringify(buildRelayRequest(messages, model, returnReasoning, provider, tools, maxTokens)),
    signal,
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    const contentType = upstream.headers.get("content-type") || "";
    const readableDetail = /json|text\/plain/i.test(contentType) && !/^\s*</.test(detail)
      ? detail.replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
    const error = new Error(`中转站返回 ${upstream.status}${readableDetail ? `：${readableDetail}` : ""}`);
    error.status = upstream.status;
    error.retryable = upstream.status === 408 || upstream.status === 429 || upstream.status >= 500;
    throw error;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let text = "";
  let reasoning = "";
  let finishReason = "";
  const callsByIndex = new Map();
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      error.partialOutput = Boolean(text || reasoning || callsByIndex.size);
      error.retryable = !error.partialOutput;
      throw error;
    }
    const { value, done } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const dataLine = part.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (raw === "[DONE]") continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.usage) usage = combineStreamUsage(usage, parsed.usage);
        if (parsed.message?.usage) usage = combineStreamUsage(usage, parsed.message.usage);
        const reportedFinishReason = provider.protocol === "anthropic"
          ? parsed.delta?.stop_reason || parsed.stop_reason || parsed.message?.stop_reason
          : parsed.choices?.[0]?.finish_reason;
        if (reportedFinishReason) finishReason = String(reportedFinishReason);
        const choiceDelta = parsed.choices?.[0]?.delta || {};
        if (provider.protocol === "anthropic" && parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
          const block = parsed.content_block;
          callsByIndex.set(parsed.index ?? callsByIndex.size, {
            id: block.id || `tool_${randomUUID().slice(0, 8)}`,
            name: block.name || "",
            arguments: block.input && Object.keys(block.input).length ? block.input : null,
            argumentsText: "",
          });
        }
        if (provider.protocol === "anthropic" && parsed.delta?.type === "input_json_delta") {
          const index = parsed.index ?? 0;
          const call = callsByIndex.get(index) || { id: `tool_${randomUUID().slice(0, 8)}`, name: "", arguments: null, argumentsText: "" };
          call.argumentsText += parsed.delta.partial_json || "";
          callsByIndex.set(index, call);
        }
        if (provider.protocol !== "anthropic" && Array.isArray(choiceDelta.tool_calls)) {
          for (const deltaCall of choiceDelta.tool_calls) {
            const index = deltaCall.index ?? callsByIndex.size;
            const call = callsByIndex.get(index) || { id: "", name: "", arguments: null, argumentsText: "" };
            if (deltaCall.id) call.id = deltaCall.id;
            if (deltaCall.function?.name) call.name += deltaCall.function.name;
            if (deltaCall.function?.arguments) call.argumentsText += deltaCall.function.arguments;
            callsByIndex.set(index, call);
          }
        }
        const choiceMessage = parsed.choices?.[0]?.message || {};
        const reasoningDelta = provider.protocol === "anthropic"
          ? reasoningDeltaText(parsed.delta?.thinking || (parsed.delta?.type === "thinking_delta" ? parsed.delta : ""))
          : reasoningDeltaText(choiceDelta.reasoning_content ?? choiceDelta.reasoning ?? choiceDelta.thinking ?? choiceDelta.reasoning_details ?? choiceMessage.reasoning_content ?? choiceMessage.reasoning ?? choiceMessage.thinking ?? choiceMessage.reasoning_details);
        const delta = provider.protocol === "anthropic"
          ? parsed.delta?.text || parsed.content_block?.text || ""
          : choiceDelta.content || "";
        if (returnReasoning && reasoningDelta) { reasoning += reasoningDelta; sendSse(res, "reasoning_delta", { text: reasoningDelta }); }
        if (delta) { text += delta; sendSse(res, "delta", { text: delta }); }
      } catch {
        // Ignore non-JSON comments emitted by a compatible relay.
      }
    }
  }
  const toolCalls = [...callsByIndex.values()].map((call) => ({ ...call, id: call.id || `tool_${randomUUID().slice(0, 8)}` })).filter((call) => call.name);
  return { usage, text, reasoning, toolCalls, finishReason };
}

function relayRetryable(error) {
  if (!error || error.name === "AbortError" || error.partialOutput) return false;
  if (error.retryable === true) return true;
  const status = Number(error.status || 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(String(error.message || error.cause?.code || ""));
}

function relayToolCompatibilityError(error) {
  const status = Number(error?.status || 0);
  if (![400, 404, 415, 422].includes(status)) return false;
  return /tool|function|schema|parameter|unsupported|unknown field|invalid request/i.test(String(error?.message || ""));
}

function waitForRelayRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function streamRelayWithRetry(messages, model, res, options) {
  const delays = [600, 1400];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await streamRelayOnce(messages, model, res, options);
    } catch (error) {
      lastError = error;
      if (attempt >= delays.length || !relayRetryable(error)) throw error;
      await waitForRelayRetry(delays[attempt], options.signal);
    }
  }
  throw lastError;
}

async function streamRelay(messages, model, res, { returnReasoning = false, signal, provider, useTools = true, historyToolEnabled = false, voiceToolEnabled = false, voiceCallToolEnabled = false, toolMode = "", localMusicIndex = [], maxTokens = 0 } = {}) {
  let tools = [];
  if (useTools || historyToolEnabled) {
    try {
      tools = await toolService.listModelTools();
      if (toolMode === "music") tools = toolService.spotifyPublicConfig().controlAvailable ? tools.filter((tool) => tool.name.startsWith("spotify_")) : [];
      else if (!useTools) tools = tools.filter((tool) => ["search_original_conversation", "expand_original_conversation"].includes(tool.name));
    } catch (error) { sendSse(res, "tool_notice", { message: `工具列表暂不可用：${error.message}` }); }
  }
  if (useTools && localMusicIndex.length) tools.push(localMusicToolDefinition(localMusicIndex));
  tools.unshift(...voiceOutputToolDefinitions({ message: voiceToolEnabled, call: voiceCallToolEnabled }));
  const relayMessages = messages.map((message) => ({ ...message }));
  const totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model_rounds: 0,
    tool_calls: 0,
    round_input_tokens: [],
    request_message_count: messages.length,
    request_character_count: JSON.stringify(messages).length,
    provider_id: provider.id,
    provider_name: provider.name || provider.id,
    model,
  };
  let originalSearchCalls = 0;
  let originalExpandCalls = 0;
  const originalSeenMessageIds = new Set();
  for (let round = 0; round < 5; round += 1) {
    let step;
    try {
      step = await streamRelayWithRetry(relayMessages, model, res, { returnReasoning, signal, provider, tools, maxTokens });
    } catch (error) {
      if (round === 0 && tools.length && relayToolCompatibilityError(error)) {
        sendSse(res, "tool_notice", { message: "当前中转站不接受工具参数，已回退为普通对话。" });
        tools = [];
        step = await streamRelayWithRetry(relayMessages, model, res, { returnReasoning, signal, provider, tools, maxTokens });
      } else {
        throw error;
      }
    }
    mergeUsage(totalUsage, step.usage);
    totalUsage.tool_calls += step.toolCalls.length;
    if (!step.toolCalls.length) {
      if (totalUsage.total_tokens) sendSse(res, "usage", { usage: totalUsage });
      sendSse(res, "finish", { reason: step.finishReason || "" });
      return;
    }

    const executed = [];
    for (const call of step.toolCalls) {
      let args = {};
      let result;
      let error = false;
      sendSse(res, "tool_start", { id: call.id, name: call.name });
      try {
        args = toolCallArguments(call);
        sendSse(res, "tool_arguments", { id: call.id, name: call.name, arguments: args });
        if (call.name === "search_original_conversation" && originalSearchCalls >= 2) throw new Error("本轮已完成两次原文检索，请先根据已有结果回答");
        if (call.name === "expand_original_conversation" && originalExpandCalls >= 3) throw new Error("本轮已读取三页相邻原文；请先根据已有结果回答，下一轮再继续翻页");
        if (call.name === "search_original_conversation") originalSearchCalls += 1;
        if (call.name === "expand_original_conversation") originalExpandCalls += 1;
        if (call.name === "local_music_play") {
          const selectedTrack = localMusicIndex.find((track) => track.id === String(args.trackId || ""));
          if (!selectedTrack) throw new Error("本地曲目不存在或已经移除");
          result = { accepted: true, source: "local", selectedTrack };
        } else result = await toolService.executeTool(call.name, args);
        error = result?.isError === true;
      } catch (toolError) {
        error = true;
        result = { error: toolError.message || "工具调用失败" };
      }
      const terminalOutputTool = ["send_voice_message", "start_voice_call", "favorite_user_message", "local_music_play"].includes(call.name);
      const originalConversationTool = ["search_original_conversation", "expand_original_conversation"].includes(call.name);
      const resultText = terminalOutputTool
        ? JSON.stringify({ accepted: !error })
        : originalConversationTool && !error
          ? compactOriginalToolResult(call.name, result, originalSeenMessageIds)
          : compactToolResult(result);
      sendSse(res, "tool_result", {
        id: call.id,
        name: call.name,
        arguments: args,
        error,
        summary: terminalOutputTool ? (error ? "动作执行失败" : call.name === "send_voice_message" ? "语音生成请求已接收" : call.name === "start_voice_call" ? "来电邀请已创建" : call.name === "local_music_play" ? toolResultSummary(result) : "已收藏这条用户消息") : toolResultSummary(result),
        openUrl: result?.openUrl || result?.tracks?.[0]?.openUrl || result?.track?.openUrl || "",
      });
      executed.push({ call, args, resultText, error });
    }
    const completedTerminalAction = executed.find((item) => ["send_voice_message", "start_voice_call", "favorite_user_message", "local_music_play"].includes(item.call.name) && !item.error);
    if (completedTerminalAction) {
      if (completedTerminalAction.call.name === "favorite_user_message" && !step.text.trim()) {
        sendSse(res, "delta", { text: "我把这句话收藏下来了。" });
      }
      if (completedTerminalAction.call.name === "local_music_play" && !step.text.trim()) {
        const selected = completedTerminalAction.result?.selectedTrack;
        sendSse(res, "delta", { text: selected ? `我选了《${selected.title}》，现在放给你听。` : "我已经选好一首歌了。" });
      }
      if (totalUsage.total_tokens) sendSse(res, "usage", { usage: totalUsage });
      sendSse(res, "finish", { reason: step.finishReason || "tool_call" });
      return;
    }
    appendToolRound(relayMessages, step, executed, provider.protocol);
  }
  throw new Error("工具调用次数超过单次对话上限（5 轮）");
}

function requestedModel(value) {
  if (typeof value !== "string") return "";
  const model = value.trim();
  return /^[\w./:-]{1,128}$/.test(model) ? model : "";
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req, 12_000_000));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法解析请求" });
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const requestedProvider = providerById(String(payload.providerId || ""));
  const provider = requestedProvider && !isVoiceServiceProvider(requestedProvider) ? requestedProvider : activeProvider();
  const model = requestedModel(payload.model) || provider.model;
  const returnReasoning = payload.returnReasoning === true;
  const useTools = payload.useTools !== false;
  const historyToolEnabled = payload.historyToolEnabled === true;
  const voiceToolEnabled = payload.voiceToolEnabled === true;
  const voiceCallToolEnabled = payload.voiceCallToolEnabled === true;
  const toolMode = payload.toolMode === "music" ? "music" : "";
  const localMusicIndex = sanitizeLocalMusicIndex(payload.localMusicIndex);
  const maxTokens = Number.isFinite(Number(payload.maxTokens)) ? Math.max(80, Math.min(12000, Math.round(Number(payload.maxTokens)))) : 0;
  const relayReady = Boolean(provider.baseUrl && provider.apiKey && model);
  const upstreamController = new AbortController();
  const abortUpstream = () => { if (!res.writableEnded) upstreamController.abort(); };
  res.once("close", abortUpstream);
  sendSseHeaders(res);
  try {
    if (!relayReady) {
      const reply = demoReply(messages);
      for (const chunk of reply.match(/.{1,18}/gs) || [reply]) {
        if (upstreamController.signal.aborted) break;
        sendSse(res, "delta", { text: chunk });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 18));
      }
    } else {
      await streamRelay(messages, model, res, { returnReasoning, signal: upstreamController.signal, provider, useTools, historyToolEnabled, voiceToolEnabled, voiceCallToolEnabled, toolMode, localMusicIndex, maxTokens });
    }
    if (!upstreamController.signal.aborted && !res.destroyed) sendSse(res, "done", { demo: !relayReady, model: model || "演示模式", providerId: provider.id });
  } catch (error) {
    if (error.name !== "AbortError" && !upstreamController.signal.aborted && !res.destroyed) sendSse(res, "error", { message: error.message || "中转站请求失败" });
  } finally {
    res.off("close", abortUpstream);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

async function handleHistorySync(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req, 16_000_000));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法解析历史记录" });
  }
  try {
    const local = historyService.upsertMessages(payload.messages);
    let supabase = null;
    let supabaseError = "";
    if (payload.syncSupabase !== false && supabaseService.historyReady()) {
      try { supabase = await supabaseService.syncMessages(payload.messages); }
      catch (error) { supabaseError = error.message || "Supabase 同步失败"; }
    }
    return json(res, 200, { ...local, local, supabase, supabaseError });
  } catch (error) {
    return json(res, 500, { error: error.message || "无法保存历史记录" });
  }
}

async function handleHistoryDelete(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req, 1_000_000)); }
  catch (error) { return json(res, 400, { error: error.message || "无法解析删除记录" }); }
  try {
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    const local = historyService.deleteMessages(ids);
    let supabase = null;
    let supabaseError = "";
    if (supabaseService.historyReady()) {
      try { supabase = await supabaseService.deleteMessages(ids); }
      catch (error) { supabaseError = error.message || "Supabase 删除同步失败"; }
    }
    return json(res, 200, { local, supabase, supabaseError });
  } catch (error) {
    return json(res, 500, { error: error.message || "无法删除历史记录" });
  }
}

async function handleHistorySearch(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req, 100_000));
    return json(res, 200, historyService.search(payload));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法查询历史记录" });
  }
}

async function handleSupabaseConfigUpdate(req, res) {
  try {
    const payload = await readJsonRequest(req);
    return json(res, 200, { config: supabaseService.setConfig(payload) });
  } catch (error) {
    return json(res, 400, { error: error.message || "无法保存 Supabase 配置" });
  }
}

async function handleSupabaseTest(req, res) {
  try {
    return json(res, 200, await supabaseService.test());
  } catch (error) {
    return json(res, 400, { error: error.message || "Supabase 连接失败" });
  }
}

async function handleSupabaseSyncStatus(_req, res) {
  try { return json(res, 200, await supabaseService.syncStatus()); }
  catch (error) { return json(res, 400, { error: error.message || "无法读取 Supabase 同步状态" }); }
}

function handleSupabaseMigrationSql(_req, res) {
  const file = join(ROOT, "supabase", "amid_chat_sync_migration.sql");
  if (!existsSync(file)) return json(res, 404, { error: "没有找到 Supabase 升级 SQL" });
  return json(res, 200, { sql: readFileSync(file, "utf8") });
}

async function handleSupabaseAudioUpload(req, res) {
  let audio;
  try { audio = await readBinaryBody(req, 30_000_000); }
  catch (error) { return json(res, 413, { error: error.message || "无法读取语音文件" }); }
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const result = await supabaseService.uploadAudio(audio, {
      messageId: url.searchParams.get("messageId"),
      mimeType: String(req.headers["content-type"] || "audio/webm").split(";")[0],
    });
    return json(res, 200, result);
  } catch (error) {
    return json(res, 400, { error: error.message || "语音上传失败" });
  }
}

async function handleVoiceTranscription(req, res) {
  if (!elevenLabsReady()) return json(res, 503, { error: "ElevenLabs API 尚未配置" });
  const voice = effectiveElevenLabsConfig();
  let audio;
  try {
    audio = await readBinaryBody(req);
  } catch (error) {
    return json(res, 413, { error: error.message || "无法读取录音" });
  }
  if (!audio.length) return json(res, 400, { error: "没有收到录音" });

  const contentType = String(req.headers["content-type"] || "audio/webm").split(";")[0];
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `amid-call.${audioFileExtension(contentType)}`);
  form.append("model_id", voice.sttModel);
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  try {
    const upstream = await fetch(`${voice.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": voice.apiKey },
      body: form,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`ElevenLabs STT 返回 ${upstream.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
    }
    const transcript = await upstream.json();
    return json(res, 200, {
      text: typeof transcript.text === "string" ? transcript.text.trim() : "",
      languageCode: transcript.language_code || "",
    });
  } catch (error) {
    return json(res, 502, { error: error.message || "语音识别失败" });
  }
}

async function handleVoiceSpeech(req, res) {
  if (!elevenLabsReady({ requireVoice: true })) return json(res, 503, { error: "ElevenLabs API 或 Voice ID 尚未配置" });
  const voice = effectiveElevenLabsConfig();
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    return json(res, 400, { error: error.message || "无法解析语音合成请求" });
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json(res, 400, { error: "没有可朗读的内容" });
  if (text.length > 5000) return json(res, 400, { error: "单次朗读内容过长" });
  const callDelivery = payload.delivery === "expressive"
    ? { stability: 0.3, similarity_boost: 0.76, style: 0.38 }
    : payload.delivery === "stable"
      ? { stability: 0.64, similarity_boost: 0.82, style: 0.08 }
      : { stability: 0.42, similarity_boost: 0.78, style: 0.22 };
  const voiceSettings = payload.purpose === "call"
    ? { ...callDelivery, speed: Math.max(0.7, Math.min(1.2, Number(payload.speed) || 0.92)), use_speaker_boost: true }
    : payload.preset === "soft"
    ? { stability: 0.58, similarity_boost: 0.76, style: 0.18, use_speaker_boost: true }
    : payload.preset === "clear"
      ? { stability: 0.72, similarity_boost: 0.82, style: 0.05, use_speaker_boost: true }
      : null;
  const ttsModel = payload.purpose === "message" ? voice.messageTtsModel : voice.callTtsModel;

  try {
    const voiceId = encodeURIComponent(voice.voiceId);
    const models = payload.purpose === "message" && ttsModel !== "eleven_flash_v2_5" ? [ttsModel, "eleven_flash_v2_5"] : [ttsModel];
    let speech = null;
    let lastError = null;
    for (const [index, model] of models.entries()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), index === 0 ? 25_000 : 20_000);
      try {
        const upstream = await fetch(`${voice.baseUrl}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: {
            "xi-api-key": voice.apiKey,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({ text, model_id: model, ...(voiceSettings ? { voice_settings: voiceSettings } : {}) }),
          signal: controller.signal,
        });
        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          const upstreamError = new Error(`ElevenLabs TTS 返回 ${upstream.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
          upstreamError.status = upstream.status;
          upstreamError.detail = detail;
          throw upstreamError;
        }
        speech = {
          body: Buffer.from(await upstream.arrayBuffer()),
          contentType: upstream.headers.get("content-type") || "audio/mpeg",
          model,
          fallback: index > 0,
        };
        break;
      } catch (error) {
        lastError = error.name === "AbortError" ? new Error(`${model} 语音生成超时`) : error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!speech) {
      if (lastError?.status === 404) {
        const voiceCheck = await probeElevenLabs(`/voices/${encodeURIComponent(voice.voiceId)}`);
        if (!voiceCheck.ok) throw new Error("当前 Voice ID 不在这把 ElevenLabs 密钥可用的音色列表里。请到 设置 → 语音配置 → 检测权限并获取音色，选择账户中的音色后重新保存。");
        throw new Error(`ElevenLabs 识别了当前音色，但语音合成接口返回 404。请检查 API 地址和合成模型${lastError.detail ? `：${lastError.detail.slice(0, 160)}` : ""}`);
      }
      throw lastError || new Error("ElevenLabs 没有返回语音");
    }
    res.writeHead(200, {
      "content-type": speech.contentType,
      "cache-control": "no-store",
      "content-length": speech.body.length,
      "x-elevenlabs-model": speech.model,
      "x-elevenlabs-fallback": speech.fallback ? "flash" : "none",
    });
    res.end(speech.body);
  } catch (error) {
    return json(res, 502, { error: error.message || "语音合成失败" });
  }
}

async function handleVoiceTtsToken(_req, res) {
  if (!elevenLabsReady({ requireVoice: true })) return json(res, 503, { error: "ElevenLabs API 或 Voice ID 尚未配置" });
  const voice = effectiveElevenLabsConfig();
  try {
    const upstream = await fetch(`${voice.baseUrl}/single-use-token/tts_websocket`, {
      method: "POST",
      headers: { "xi-api-key": voice.apiKey, accept: "application/json" },
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !payload.token) throw new Error(payload.detail?.message || payload.detail || payload.error || `ElevenLabs 返回 ${upstream.status}`);
    const websocketBase = voice.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const params = new URLSearchParams({
      model_id: voice.callTtsModel,
      output_format: "mp3_44100_128",
      inactivity_timeout: "120",
      sync_alignment: "false",
      single_use_token: payload.token,
    });
    return json(res, 200, {
      url: `${websocketBase}/text-to-speech/${encodeURIComponent(voice.voiceId)}/stream-input?${params}`,
      model: voice.callTtsModel,
    });
  } catch (error) {
    return json(res, 502, { error: error.message || "无法创建 ElevenLabs TTS WebSocket 令牌" });
  }
}

async function handleVoiceSttToken(_req, res) {
  if (!elevenLabsReady()) return json(res, 503, { error: "ElevenLabs API 尚未配置" });
  const voice = effectiveElevenLabsConfig();
  try {
    const upstream = await fetch(`${voice.baseUrl}/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": voice.apiKey, accept: "application/json" },
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !payload.token) throw new Error(payload.detail?.message || payload.detail || payload.error || `ElevenLabs 返回 ${upstream.status}`);
    const websocketBase = voice.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_16000",
      commit_strategy: "manual",
      token: payload.token,
    });
    return json(res, 200, { url: `${websocketBase}/speech-to-text/realtime?${params}`, model: "scribe_v2_realtime" });
  } catch (error) {
    return json(res, 502, { error: error.message || "无法创建 ElevenLabs 实时 STT 令牌" });
  }
}

function serveStatic(req, res) {
  const requested = decodeURIComponent(req.url.split("?")[0]);
  const relative = requested === "/" ? "/index.html" : requested;
  const filePath = normalize(join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = join(PUBLIC_DIR, "index.html");
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
    return res.end(readFileSync(fallback));
  }
  const extension = extname(filePath);
  const shouldRevalidate = [".html", ".js", ".css", ".webmanifest"].includes(extension);
  res.writeHead(200, {
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "cache-control": relative === "/sw.js" ? "no-store" : shouldRevalidate ? "no-cache" : "public, max-age=3600",
  });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && req.url.startsWith("/api/tools/spotify/callback")) return handleSpotifyCallback(req, res);
  if (req.method === "GET" && req.url === "/api/auth/check") {
    return isAuthorizedRequest(req) ? json(res, 200, { authorized: true, protected: Boolean(ACCESS_TOKEN) }) : json(res, 401, { error: "访问令牌不正确" });
  }
  if (req.url.startsWith("/api/") && !isAuthorizedRequest(req)) return json(res, 401, { error: "需要先解锁此间" });
  if (req.method === "GET" && req.url === "/api/config") {
    const provider = activeProvider();
    const voice = publicVoiceConfig();
    return json(res, 200, {
      configured: Boolean(provider.baseUrl && provider.apiKey && provider.model),
      credentialsConfigured: Boolean(provider.baseUrl && provider.apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model || "未选择模型",
      protocol: provider.protocol,
      voiceConfigured: voice.configured,
      voiceProvider: voice.provider,
      voiceIdConfigured: voice.voiceIdConfigured,
      voiceName: voice.voiceName,
      sttModel: voice.sttModel,
      ttsModel: voice.callTtsModel,
      messageTtsModel: voice.messageTtsModel,
      callTtsModel: voice.callTtsModel,
    });
  }
  if (req.method === "GET" && req.url.startsWith("/api/providers/config-file")) return handleReadProviderConfigFile(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/providers")) {
    const providers = [environmentProvider(), ...providerStore.providers.filter((provider) => !isVoiceServiceProvider(provider))].map(publicProvider);
    return json(res, 200, { activeId: activeProvider().id, providers });
  }
  if (req.method === "POST" && req.url === "/api/providers/upsert") return handleProviderUpsert(req, res);
  if (req.method === "POST" && req.url === "/api/providers/active") return handleProviderActivation(req, res);
  if (req.method === "POST" && req.url === "/api/providers/delete") return handleProviderDelete(req, res);
  if (req.method === "POST" && req.url === "/api/providers/open-config") return handleOpenProviderConfig(req, res);
  if (req.method === "POST" && req.url === "/api/providers/config-file") return handleSaveProviderConfigFile(req, res);
  if (req.method === "POST" && req.url === "/api/providers/reload") return handleReloadProviderConfig(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/models")) return handleModels(req, res);
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && req.url === "/api/history/status") return json(res, 200, historyService.status());
  if (req.method === "POST" && req.url === "/api/history/sync") return handleHistorySync(req, res);
  if (req.method === "POST" && req.url === "/api/history/delete") return handleHistoryDelete(req, res);
  if (req.method === "POST" && req.url === "/api/history/search") return handleHistorySearch(req, res);
  if (req.method === "GET" && req.url === "/api/supabase/config") return json(res, 200, supabaseService.publicConfig());
  if (req.method === "POST" && req.url === "/api/supabase/config") return handleSupabaseConfigUpdate(req, res);
  if (req.method === "POST" && req.url === "/api/supabase/test") return handleSupabaseTest(req, res);
  if (req.method === "GET" && req.url === "/api/supabase/sync-status") return handleSupabaseSyncStatus(req, res);
  if (req.method === "GET" && req.url === "/api/supabase/migration-sql") return handleSupabaseMigrationSql(req, res);
  if (req.method === "POST" && req.url.startsWith("/api/supabase/audio?")) return handleSupabaseAudioUpload(req, res);
  if (req.method === "GET" && req.url === "/api/voice/config") return json(res, 200, publicVoiceConfig());
  if (req.method === "POST" && req.url === "/api/voice/config") return handleVoiceConfigUpdate(req, res);
  if (req.method === "GET" && req.url === "/api/voice/catalog") return handleVoiceCatalog(req, res);
  if (req.method === "GET" && req.url === "/api/voice/validate") return handleVoiceValidation(req, res);
  if (req.method === "POST" && req.url === "/api/voice/transcribe") return handleVoiceTranscription(req, res);
  if (req.method === "POST" && req.url === "/api/voice/stt-token") return handleVoiceSttToken(req, res);
  if (req.method === "POST" && req.url === "/api/voice/tts-token") return handleVoiceTtsToken(req, res);
  if (req.method === "POST" && req.url === "/api/voice/speak") return handleVoiceSpeech(req, res);
  if (req.method === "GET" && req.url === "/api/tools/config") return json(res, 200, toolsPublicConfig(req));
  if (req.method === "GET" && req.url === "/api/tools/definitions") return handleModelToolDefinitions(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/tools/weather/search")) return handleWeatherSearch(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/tools/weather/current")) return handleCurrentWeather(req, res);
  if (req.method === "POST" && req.url === "/api/tools/weather/location") return handleWeatherLocationUpdate(req, res);
  if (req.method === "POST" && req.url === "/api/tools/weather/enabled") return handleWeatherEnabledUpdate(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/tools/mcp/discover")) return handleMcpDiscovery(req, res);
  if (req.method === "POST" && req.url === "/api/tools/mcp/server") return handleMcpServerUpsert(req, res);
  if (req.method === "POST" && req.url === "/api/tools/mcp/delete") return handleMcpServerDelete(req, res);
  if (req.method === "POST" && req.url === "/api/tools/mcp/enabled") return handleMcpEnabledUpdate(req, res);
  if (req.method === "POST" && req.url === "/api/tools/spotify/config") return handleSpotifyConfigUpdate(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/tools/spotify/authorize")) return handleSpotifyAuthorization(req, res);
  if (req.method === "POST" && req.url === "/api/tools/spotify/disconnect") return handleSpotifyDisconnect(req, res);
  if (req.method === "POST" && req.url === "/api/tools/spotify/find") return handleSpotifyFind(req, res);
  if (req.method === "GET" && req.url === "/api/tools/spotify/playback") return handleSpotifyPlayback(req, res);
  if (req.method === "POST" && req.url === "/api/tools/spotify/control") return handleSpotifyControl(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  return json(res, 405, { error: "Method Not Allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Amid is running at http://${HOST}:${PORT}`);
  console.log(ACCESS_TOKEN ? "Private API access protection enabled" : "Warning: AMID_ACCESS_TOKEN is not set; API access is unprotected");
  console.log(config.baseUrl ? `Relay configured: ${config.baseUrl}` : "Relay not configured: using local demo mode");
});
