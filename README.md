# 此间 · Amid

一个有入口、有记忆、有时间感的私人数字空间。当前版本使用 Node 原生 HTTP 服务，不依赖 Docker。

## 启动

```powershell
npm.cmd run dev
```

浏览器打开 <http://localhost:4173>。同一局域网的手机使用 `http://电脑局域网IP:4173`。

没有配置中转站时，应用会进入本地演示模式，仍然可以浏览页面并测试流式对话 UI。接入真实模型时，直接编辑项目根目录的 `.env`：

```text
LLM_BASE_URL=https://你的中转站/v1
LLM_API_KEY=你的中转站密钥
LLM_MODEL=中转站实际模型名
LLM_PROTOCOL=openai
```

`LLM_PROTOCOL` 可设为 `openai` 或 `anthropic`。密钥只在服务端读取，不会下发给前端。中转站协议差异被隔离在 `server.js` 的 Provider Adapter 层。

## 安卓手机独立运行（Termux，推荐）

此间可以像 SillyTavern 一样直接在安卓手机上运行：Termux 负责 Node 后端，Chrome 通过手机自己的 `localhost` 打开并安装 PWA。不依赖电脑、公网服务器、域名或 Docker，也没有服务器月费。

### 安装

1. 从 F-Droid 安装最新版 **Termux**。如需开机自动恢复，再安装同一来源的 **Termux:Boot**，并手动打开 Termux:Boot 一次。
2. 把 `Amid-Termux.zip` 放到手机的“下载”目录。
3. 打开 Termux，依次执行：

```sh
termux-setup-storage
pkg update -y
pkg install -y unzip
cd ~/storage/downloads
unzip -o Amid-Termux.zip -d Amid-Termux
bash Amid-Termux/scripts/termux/install.sh
```

4. Chrome 打开 <http://localhost:4173>，从浏览器菜单选择“安装应用”或“添加到主屏幕”。以后桌面图标会以独立窗口打开，不显示网址栏。

常用的 Termux 命令：

```sh
amid open       # 启动并打开
amid status     # 检查运行状态
amid restart    # 重启服务
amid stop       # 停止服务
amid logs       # 查看最近日志
amid update     # 从手机下载目录安装新版
```

### 以后更新

电脑端重新生成新版 `Amid-Termux.zip` 后，把它传到手机“下载”目录并覆盖旧文件，然后在 Termux 中执行：

```sh
amid update
```

更新命令会把压缩包解到临时目录、覆盖 `~/Amid` 中的程序文件并自动重启。`~/Amid/.env`、`~/.local/share/amid` 和 Chrome/PWA 中的数据都不会被覆盖。如果浏览器仍显示旧界面，完全退出此间后重新打开一次，让 Service Worker 完成更新。

安装器只监听 `127.0.0.1`，其他设备无法访问，所以本机模式不要求访问令牌。服务商密钥存放在手机 Termux 的私有目录；服务端配置位于 `~/.local/share/amid`，项目更新不会覆盖。聊天、日记、朋友圈、核心记忆和贴画仍由 PWA 保存在手机浏览器本地。

安装器会申请 wake lock，并提前放好 `~/.termux/boot/amid`。要提高后台稳定性，还应在手机系统设置中把 Termux 的电池策略改为“允许后台活动/不受限制”。系统仍可能在省电或清理后台时终止 Termux，此时重新执行 `amid open` 即可。

当前电脑地址和手机 `localhost` 是两个不同的浏览器存储空间，已有日记与聊天不会自动迁移。全量备份/恢复入口尚未完成，确认手机端数据正常前不要删除原浏览器中的旧数据。

## 公网 PWA（Railway，可选）

如需在多台设备间访问，仍可以把整个 Node 服务部署到 Railway：

1. 把本项目放到私人 GitHub 仓库，在 Railway 新建项目并选择 **Deploy from GitHub repo**。
2. 在服务的 Variables 中至少添加 `AMID_ACCESS_TOKEN`，值应为足够长的随机字符串。模型和语音密钥可同时作为 `LLM_*`、`ELEVENLABS_*` 变量添加，也可以部署后在应用设置中配置。
3. 给服务添加 Volume，挂载到 `/app/.data`。服务商和语音配置会写入这个持久卷，重新部署后仍会保留。
4. 在 Networking 中点击 **Generate Domain**。Railway 会生成固定的 `https://*.up.railway.app` 地址和 SSL 证书。
5. 手机 Chrome 打开该 HTTPS 地址，输入 `AMID_ACCESS_TOKEN` 解锁，然后从浏览器菜单选择“安装应用”。安装后以独立窗口启动，不显示网址栏。

`railway.toml` 已配置启动命令和 `/api/health` 健康检查。页面、日记、朋友圈、核心记忆、聊天记录和贴画仍存放在手机浏览器本地；Railway 持久卷只保存服务端密钥与服务商配置。不同网址属于不同存储空间，当前电脑 `localhost` 中的数据不会自动迁移到云端域名。

公网部署必须设置 `AMID_ACCESS_TOKEN`。没有访问令牌时服务仍兼容本地开发，但不应直接暴露到互联网。

## 语音通话

输入栏右下角的电话按钮会启动语音通话。ElevenLabs 负责语音识别与语音合成，聊天页当前选中的模型负责生成回复。要启用真实通话，在 `.env` 中加入：

```text
ELEVENLABS_API_KEY=你的 ElevenLabs 密钥
ELEVENLABS_VOICE_ID=需要使用的 Voice ID
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

配置后重启开发服务。密钥和 Voice ID 只由服务端读取，前端只能看到是否已配置。电脑或手机自己的 `localhost` 都可以申请麦克风权限；通过另一台设备的局域网 IP 使用时，需要先把页面放到 HTTPS 环境。

## 当前已实现

- 手机优先的像素字体普通主题与 PWA 外壳
- 首页 / 聊天 / 日记 / 朋友圈 / 共同记忆入口
- 日记、朋友圈、共同记忆与聊天记录保存在浏览器本机
- 每次聊天透明发送四项核心记忆；补充记忆、日记和朋友圈由提示词配置中的开关决定是否附加
- 提示词支持 `{{CURRENT_DATE}}` 与 `{{CURRENT_TIME}}`，在每次请求时按当前设备时区即时解析
- 首页 Claude 留言每天由模型生成一次，专用提示词和模型均可单独配置，成功后按日期保存在历史留言中
- 模型列表、背景、头像、Token 显示与通知配置
- Claude 站内消息弹窗；HTTPS 环境下可继续申请系统通知
- 对话 SSE 流式展示
- 语音通话：自动听写、停顿发送、模型回复、语音朗读与挂断清理
- OpenAI-compatible 与 Anthropic-compatible 中转站请求骨架
- 内置天气工具、MCP 工具发现与透明调用记录
- Spotify 双模式：免费账户由 Claude 选歌并生成一键打开链接；Premium 经 PKCE 授权后可按独立开关控制播放
- `/api/config` 技术诊断状态
- Service Worker 离线缓存

## 自主唤醒规划

AI 的周期唤醒、思考过程、行动日志与预算控制遵循 [AUTONOMY_ARCHITECTURE.md](./AUTONOMY_ARCHITECTURE.md)。以后修改聊天、日记、朋友圈、通知或记忆写入时，必须同步检查其中的统一事件链约束。

## 视觉约定

当前普通主题以清淡纸张、像素字体和手机单列结构为主。插画位与功能结构分离，后续换主题时可以替换素材和主题变量，不需要重写数据与 API 层。
