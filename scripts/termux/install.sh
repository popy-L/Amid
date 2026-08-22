#!/data/data/com.termux/files/usr/bin/bash
set -eu

SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
INSTALL_DIR="${AMID_INSTALL_DIR:-$HOME/Amid}"
DATA_DIR="${AMID_DATA_DIR:-$HOME/.local/share/amid}"

if ! command -v pkg >/dev/null 2>&1; then
  echo "这个安装脚本只能在 Android 的 Termux 中运行。" >&2
  exit 1
fi

echo "[1/5] 安装 Node.js 和基础工具"
pkg update -y
pkg install -y git curl
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs-lts
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "此间需要 Node.js 20 或更高版本，当前是 $(node --version)。请先运行 pkg upgrade。" >&2
  exit 1
fi

echo "[2/5] 安装此间到 $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$HOME/.termux/boot" "$PREFIX/bin"
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  (
    cd "$SOURCE_DIR"
    tar \
      --exclude='./.git' \
      --exclude='./.env' \
      --exclude='./.data' \
      --exclude='./node_modules' \
      --exclude='./dist' \
      --exclude='./.qa' \
      -cf - .
  ) | (
    cd "$INSTALL_DIR"
    tar -xf -
  )
fi

echo "[3/6] 安装此间运行依赖"
cd "$INSTALL_DIR"
npm install --omit=dev --ignore-scripts

echo "[4/6] 创建手机本地配置"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' \
    '# 此间在本机 Termux 中运行，只监听手机自己的 localhost。' \
    'HOST=127.0.0.1' \
    'PORT=4173' \
    "AMID_DATA_DIR=$DATA_DIR" \
    '' \
    '# 模型与语音服务可在此间的设置页面中添加。' \
    > "$ENV_FILE"
else
  grep -q '^HOST=' "$ENV_FILE" || printf '%s\n' 'HOST=127.0.0.1' >> "$ENV_FILE"
  grep -q '^PORT=' "$ENV_FILE" || printf '%s\n' 'PORT=4173' >> "$ENV_FILE"
  grep -q '^AMID_DATA_DIR=' "$ENV_FILE" || printf 'AMID_DATA_DIR=%s\n' "$DATA_DIR" >> "$ENV_FILE"
fi

echo "[5/6] 安装启动命令与开机恢复脚本"
install -m 755 "$INSTALL_DIR/scripts/termux/amid" "$PREFIX/bin/amid"
install -m 755 "$INSTALL_DIR/scripts/termux/boot-amid" "$HOME/.termux/boot/amid"

echo "[6/6] 启动此间"
amid restart

printf '\n安装完成。\n'
printf '在 Chrome 中打开 http://localhost:4173，然后选择“安装应用”。\n'
printf '以后在 Termux 输入 amid open 即可启动并打开。\n'
printf '如需开机自动恢复，请安装并至少打开一次 Termux:Boot。\n'
