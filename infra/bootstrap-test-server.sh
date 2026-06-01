#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_TEST_PATH="${DEPLOY_TEST_PATH:-/opt/bizbil-testing}"
DEPLOY_PUBLIC_KEY="${DEPLOY_PUBLIC_KEY:-}"

if [[ "$(id -u)" != "0" ]]; then
  echo "Run this bootstrap script as root." >&2
  exit 1
fi

if [[ -z "$DEPLOY_PUBLIC_KEY" ]]; then
  echo "DEPLOY_PUBLIC_KEY is required." >&2
  echo "Example: DEPLOY_PUBLIC_KEY='ssh-ed25519 AAAA...' bash infra/bootstrap-test-server.sh" >&2
  exit 1
fi

echo "==> Installing base packages"
apt-get update
apt-get install -y ca-certificates curl git openssh-server sudo

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker
systemctl enable --now ssh

if [[ "$DEPLOY_USER" != "root" ]]; then
  echo "==> Ensuring deploy user: $DEPLOY_USER"
  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  fi
  usermod -aG docker "$DEPLOY_USER"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" > "/etc/sudoers.d/$DEPLOY_USER"
  chmod 0440 "/etc/sudoers.d/$DEPLOY_USER"
  SSH_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
else
  SSH_HOME="/root"
fi

echo "==> Installing deploy public key for $DEPLOY_USER"
install -d -m 700 "$SSH_HOME/.ssh"
touch "$SSH_HOME/.ssh/authorized_keys"
chmod 600 "$SSH_HOME/.ssh/authorized_keys"
grep -qxF "$DEPLOY_PUBLIC_KEY" "$SSH_HOME/.ssh/authorized_keys" || printf '%s\n' "$DEPLOY_PUBLIC_KEY" >> "$SSH_HOME/.ssh/authorized_keys"

if [[ "$DEPLOY_USER" != "root" ]]; then
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SSH_HOME/.ssh"
fi

echo "==> Preparing deployment directory: $DEPLOY_TEST_PATH"
install -d -m 755 "$DEPLOY_TEST_PATH"
if [[ "$DEPLOY_USER" != "root" ]]; then
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_TEST_PATH"
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "==> Opening firewall ports"
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo "==> Bootstrap complete"
echo "Host: $(hostname)"
echo "Deploy user: $DEPLOY_USER"
echo "Deploy path: $DEPLOY_TEST_PATH"
