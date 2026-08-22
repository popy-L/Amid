# Codex 切换服务商后的聊天恢复手册（Windows）

这份手册用于以下情况：使用 CCSwitch 或手工修改 Codex 的 API 服务商后，旧聊天文件仍在本机，但桌面端项目侧边栏不再显示它们。

核心原则：**切换认证/API 配置与本地聊天存储是两件事。先找出旧任务 ID，再直接恢复；不要为了找聊天覆盖 `auth.json` 或 `config.toml`。**

## 本次已确认的“主线”

- 项目目录：`C:\Users\联想\Documents\Amid`
- 标题：`主线`
- 任务 ID：`019fc7e6-7b8c-7000-b698-8d0c5a3b532b`
- 原服务商标记：`openai`
- 创建时间：`2026-08-03 09:53:18`
- 最后更新时间：`2026-08-03 13:45:42`
- 状态：未归档
- 会话文件：`C:\Users\联想\.codex\sessions\2026\08\03\rollout-2026-08-03T09-53-18-019fc7e6-7b8c-7000-b698-8d0c5a3b532b.jsonl`

在 Codex 桌面端中，可以让 Codex 直接使用这个任务 ID 打开“主线”：

```text
请不要修改任何数据库，只调用 codex_app__navigate_to_codex_page，
打开任务 019fc7e6-7b8c-7000-b698-8d0c5a3b532b。
```

## 切换服务商前：先做聊天专用备份

先完全退出 Codex，再在 PowerShell 中运行。备份不包含 `auth.json`，避免复制 API key；也不需要用旧认证文件覆盖新服务商配置。

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$backupRoot = Join-Path $env:USERPROFILE "Documents\codex-chat-backup-$stamp"

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($folder in @("sessions", "archived_sessions")) {
    $source = Join-Path $codexRoot $folder
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $backupRoot -Recurse
    }
}

foreach ($name in @("state_5.sqlite", "state_5.sqlite-wal", "state_5.sqlite-shm", "session_index.jsonl", ".codex-global-state.json")) {
    $source = Join-Path $codexRoot $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $backupRoot
    }
}

$catalogSource = Join-Path $codexRoot "sqlite"
$catalogBackup = Join-Path $backupRoot "sqlite"
if (Test-Path -LiteralPath $catalogSource) {
    New-Item -ItemType Directory -Path $catalogBackup -Force | Out-Null
    Get-ChildItem -LiteralPath $catalogSource -Filter "codex-dev.db*" |
        Copy-Item -Destination $catalogBackup
}

Get-ChildItem -LiteralPath $backupRoot -Recurse |
    Select-Object FullName, Length, LastWriteTime
```

## 切换后第一步：确认数据目录没有变

```powershell
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }

"CODEX_HOME=$env:CODEX_HOME"
"实际数据目录=$codexRoot"

Get-ChildItem -LiteralPath (Join-Path $codexRoot "sessions") -Recurse -File -Filter "*.jsonl" |
    Measure-Object
```

如果 `CODEX_HOME` 在切换前后不同，旧聊天通常仍在旧目录。不要移动或删除任何一边，先分别检查两个目录。

## 按项目和标题查找任务 ID

本机 Node.js 24 可以只读查询 Codex 的 `state_5.sqlite`，不需要安装 SQLite。修改前两行的项目路径和标题即可复用。

```powershell
$env:CODEX_RECOVERY_PROJECT = "C:\Users\联想\Documents\Amid"
$env:CODEX_RECOVERY_TITLE = "主线"

$code = @'
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const codexRoot = process.env.CODEX_HOME || path.join(process.env.USERPROFILE, ".codex");
const project = process.env.CODEX_RECOVERY_PROJECT;
const title = process.env.CODEX_RECOVERY_TITLE;

if (!project || !title) {
  throw new Error("缺少 CODEX_RECOVERY_PROJECT 或 CODEX_RECOVERY_TITLE");
}

const db = new DatabaseSync(path.join(codexRoot, "state_5.sqlite"), { readOnly: true });
const rows = db.prepare(`
  SELECT
    id,
    title,
    model_provider,
    archived,
    datetime(created_at, 'unixepoch', 'localtime') AS created_local,
    datetime(updated_at, 'unixepoch', 'localtime') AS updated_local,
    rollout_path
  FROM threads
  WHERE cwd LIKE ?
    AND thread_source = 'user'
    AND title LIKE ?
  ORDER BY updated_at DESC
`).all(`%${project}`, `%${title}%`);

console.table(rows);
db.close();
'@

$code | node -
```

查询是只读的。不要对 `threads` 表执行 `UPDATE`、`INSERT` 或 `DELETE`。

如果 Node 报 `No such built-in module: node:sqlite`，说明当前 Node 版本太旧。此时不要急着安装数据库工具，直接把项目路径和标题告诉 Codex，让它按同样条件只读查询。

## 找到任务 ID 后如何打开

### 方法 A：Codex 桌面端直接打开

把查到的 ID 发给 Codex：

```text
只读处理，不修改数据库。请使用 codex_app__navigate_to_codex_page
打开任务 <任务 ID>。
```

这是本次恢复“主线”实际验证成功的方法。

### 方法 B：Codex CLI 恢复

官方手册支持在项目目录中使用 `/resume`，或从终端运行 `codex resume`：

```powershell
Set-Location -LiteralPath "C:\Users\联想\Documents\Amid"
codex resume 019fc7e6-7b8c-7000-b698-8d0c5a3b532b
```

如果当前 Windows 沙箱不允许直接启动商店目录下的 `codex.exe`，优先使用方法 A；不要为了绕过权限去修改 Codex 安装目录。

### 方法 C：任务只是被归档

先检查桌面端：

```text
Settings > Data Controls > Archived chats
```

“主线”目前不是归档状态，因此本次问题不属于这一类。

## 能打开但续聊返回官方 API 401

这是服务商切换后的第二层问题：旧任务会保留创建时的 `model_provider`。例如“主线”仍标记为内置 `openai`，即使当前全局默认已经切到 `custom`，续聊时仍可能访问：

```text
https://api.openai.com/v1/responses
```

中转站密钥不是 OpenAI Platform 官方密钥，把它发给官方端点必然得到 `401 invalid_api_key`。这不代表中转站密钥失效，也不要求购买 OpenAI 官方 API。

官方 Codex 配置支持给内置 `openai` provider 设置代理地址。在用户级 `%USERPROFILE%\.codex\config.toml` 的顶层、任何 `[model_providers.*]` 表之前加入：

```toml
openai_base_url = "https://lyztoken.com/v1"
```

示例顺序：

```toml
model_provider = "custom"
model = "gpt-5.6-sol"
openai_base_url = "https://lyztoken.com/v1"

[model_providers.custom]
wire_api = "responses"
requires_openai_auth = true
base_url = "https://lyztoken.com/v1"
```

然后重启 Codex 后台或整个桌面端，使运行中的 app-server 重新加载配置。不要把 `openai_base_url` 放到项目内的 `.codex/config.toml`；Codex 会忽略项目级的 provider 和认证重定向配置。

本机在 `2026-08-04` 的实测结果：

1. 只打开“主线”后直接续聊，仍访问官方地址并返回 401。
2. 加入 `openai_base_url` 但未重启，运行中的后台仍返回同样的 401。
3. 重启 Codex 后台后，在原“主线”发送最小测试，成功返回 `RELAY_OK`。

因此，“找到并打开旧任务”与“让旧任务改走当前中转站”是两个步骤，缺一不可。

切回官方 ChatGPT 账号时，删除这条 `openai_base_url`，或确认 CCSwitch 已将其移除，否则旧的内置 `openai` 任务仍会被定向到中转站。

## 判断是否只是侧边栏索引坏了

聊天正文与侧边栏目录不是同一个存储层。下面的检查同样只读：

```powershell
$code = @'
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const codexRoot = process.env.CODEX_HOME || path.join(process.env.USERPROFILE, ".codex");
const db = new DatabaseSync(path.join(codexRoot, "sqlite", "codex-dev.db"), { readOnly: true });

console.log("catalog_count", db.prepare("SELECT count(*) AS n FROM local_thread_catalog").get());
console.log("sync_state", db.prepare("SELECT * FROM local_thread_catalog_sync_state").all());
db.close();
'@

$code | node -
```

本次在 `2026-08-04` 查到：

```text
local_thread_catalog = 0 条
initial_build_complete = 0
```

同时，`state_5.sqlite` 和 `sessions` 中的聊天都完整存在，项目归属也仍在。因此结论是侧边栏目录没有完成构建，不是聊天被删除。

遇到这种情况，优先按任务 ID 直接打开。不要手工向 `codex-dev.db` 填数据；它是应用内部索引，字段和重建方式可能随版本变化。

## 文件各自负责什么

以下是本机当前版本的实测布局，不应视为永久公开接口：

| 路径 | 当前作用 |
| --- | --- |
| `%USERPROFILE%\.codex\sessions\` | 未归档会话的 JSONL 正文 |
| `%USERPROFILE%\.codex\archived_sessions\` | 已归档会话正文 |
| `%USERPROFILE%\.codex\state_5.sqlite` | 任务 ID、标题、项目目录、服务商、归档状态等元数据 |
| `%USERPROFILE%\.codex\session_index.jsonl` | 部分任务的轻量标题索引 |
| `%USERPROFILE%\.codex\.codex-global-state.json` | 桌面端项目及任务归属等 UI 状态 |
| `%USERPROFILE%\.codex\sqlite\codex-dev.db` | 桌面端本地任务目录/同步状态 |
| `%USERPROFILE%\.codex\config.toml` | 当前模型和服务商配置，不是聊天正文 |
| `%USERPROFILE%\.codex\auth.json` | 当前认证/API key，不是聊天正文 |

## 不要这样做

- 不要删除整个 `%USERPROFILE%\.codex`。
- 不要通过重装 Codex 试图“刷新”聊天。
- 不要把旧 `auth.json` 或 `config.toml` 覆盖到新服务商配置上。
- 不要直接编辑 JSONL 正文。
- 不要手工修改 `state_5.sqlite` 或 `codex-dev.db`。
- 不要只看侧边栏就判断聊天已经丢失。
- 不要在 Codex 正在写入时复制 SQLite 主文件；备份前先退出 Codex。

## 最短恢复流程

1. 不删除 `.codex`，也不覆盖认证配置。
2. 确认 `sessions` 中仍有 JSONL 文件。
3. 只读查询 `state_5.sqlite`，按项目目录和标题找到任务 ID。
4. 让 Codex 使用 `codex_app__navigate_to_codex_page` 直接打开该 ID。
5. 如果续聊访问 `api.openai.com` 并返回 401，在用户级配置加入中转站 `openai_base_url`，然后重启 Codex。
6. 桌面端无法直开时，在项目目录运行 `codex resume <任务 ID>`。
7. 只有聊天文件和任务元数据都不存在时，才从切换前备份恢复。

## 依据与边界

官方 Codex 手册明确说明：聊天保留自己的 transcript 和记录的工作目录，并支持 `/resume` 与 `codex resume` 继续保存的聊天；归档聊天可以从设置中恢复。

本手册中关于 `state_5.sqlite`、`codex-dev.db` 和 `codex_app__navigate_to_codex_page` 的部分来自 `2026-08-04` 对本机 Codex 版本的只读检查与实际恢复验证。这些属于可靠的本机兜底方法，但不是承诺长期不变的公开数据库接口。`openai_base_url` 则是官方公开配置项。Codex 升级后，应继续坚持“先备份、只读定位、按 ID 打开”，并重新确认内部表名。
