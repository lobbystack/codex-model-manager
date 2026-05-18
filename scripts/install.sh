#!/usr/bin/env sh
set -eu

APP_NAME="codex-model-manager"
PORT="${CMM_PORT:-1455}"
HOST="${CMM_HOST:-127.0.0.1}"
REPO="${CMM_GITHUB_REPO:-}"
INSTALL_ROOT="${CMM_INSTALL_ROOT:-$HOME/.codex-model-manager}"

if [ -z "$REPO" ]; then
  echo "Set CMM_GITHUB_REPO=owner/repo before running this installer." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "Node.js 20 or newer is required to run $APP_NAME." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required to run $APP_NAME." >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
CPU="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux) PLATFORM="linux" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$CPU" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $CPU" >&2; exit 1 ;;
esac

ASSET="$APP_NAME-$PLATFORM-$ARCH.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$ASSET"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading $URL"
curl -fL "$URL" -o "$TMP_DIR/app.tar.gz"
mkdir -p "$TMP_DIR/package"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$TMP_DIR/package"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP_DIR/package/package.json" | head -1)"
if [ -z "$VERSION" ]; then
  echo "Unable to read package version from release artifact." >&2
  exit 1
fi

VERSIONS_DIR="$INSTALL_ROOT/app/versions"
TARGET_DIR="$VERSIONS_DIR/$VERSION"
BIN_DIR="$INSTALL_ROOT/bin"
mkdir -p "$VERSIONS_DIR" "$BIN_DIR"
rm -rf "$TARGET_DIR.tmp"
mkdir -p "$TARGET_DIR.tmp"
cp -R "$TMP_DIR/package/." "$TARGET_DIR.tmp/"
rm -rf "$TARGET_DIR"
mv "$TARGET_DIR.tmp" "$TARGET_DIR"
printf '%s\n' "$TARGET_DIR" > "$INSTALL_ROOT/app/active"

cat > "$BIN_DIR/cmm-launcher.sh" <<EOF
#!/usr/bin/env sh
set -eu
INSTALL_ROOT="$INSTALL_ROOT"
NODE_BIN="$NODE_BIN"
while true; do
  ACTIVE_DIR="\$(cat "\$INSTALL_ROOT/app/active")"
  cd "\$ACTIVE_DIR"
  CMM_RELEASE=1 CMM_GITHUB_REPO="$REPO" CMM_INSTALL_ROOT="\$INSTALL_ROOT" NITRO_HOST="$HOST" NITRO_PORT="$PORT" "\$NODE_BIN" .output/server/index.mjs
  sleep 2
done
EOF
chmod +x "$BIN_DIR/cmm-launcher.sh"

if [ "$PLATFORM" = "darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.codex-model-manager.app.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.codex-model-manager.app</string>
  <key>ProgramArguments</key>
  <array><string>$BIN_DIR/cmm-launcher.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_ROOT/app.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_ROOT/app.err.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
else
  SERVICE_DIR="$HOME/.config/systemd/user"
  SERVICE="$SERVICE_DIR/codex-model-manager.service"
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE" <<EOF
[Unit]
Description=Codex Model Manager

[Service]
ExecStart=$BIN_DIR/cmm-launcher.sh
Restart=always
RestartSec=2
Environment=CMM_INSTALL_ROOT=$INSTALL_ROOT

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now codex-model-manager.service
fi

sleep 2
if command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
fi

echo "$APP_NAME $VERSION is running at http://localhost:$PORT"
