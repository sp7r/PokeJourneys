#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    printf 'Usage: sudo bash %s <linux-arm64-build-folder> <domain>\n' "$0" >&2
    exit 2
fi
if [[ $EUID -ne 0 ]]; then
    printf 'Run this script with sudo; it installs packages and system services.\n' >&2
    exit 1
fi
source /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 || $(dpkg --print-architecture) != arm64 ]]; then
    printf 'This script requires Ubuntu 24.04 ARM64.\n' >&2
    exit 1
fi

build=$(realpath -e -- "$1")
domain=${2,,}
if [[ ${#domain} -gt 253 || ! $domain =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    printf 'Supply a domain name such as journeys.example.com, without a scheme or port.\n' >&2
    exit 2
fi
if [[ ! -f $build/PokeJourneysServer || ! -f $build/wwwroot/index.html ]]; then
    printf 'The build folder must contain PokeJourneysServer and wwwroot/index.html.\n' >&2
    exit 2
fi
if [[ $build == /opt/pokejourneys || $build == /opt/pokejourneys/* ]]; then
    printf 'Stage the build outside /opt/pokejourneys, for example in /tmp/linux-arm64.\n' >&2
    exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    caddy ca-certificates curl rsync libc6 libgcc-s1 libgssapi-krb5-2 libicu74 libssl3t64 libstdc++6 zlib1g tzdata

if ! id -u pokejourneys >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/pokejourneys --shell /usr/sbin/nologin pokejourneys
fi
install -d -m 0700 -o pokejourneys -g pokejourneys /var/lib/pokejourneys
chown -R pokejourneys:pokejourneys /var/lib/pokejourneys
install -d -m 0755 /opt/pokejourneys /etc/caddy/sites

cat > /etc/caddy/sites/pokejourneys.caddy <<EOF
$domain {
    # The admin console is reached only through an SSH tunnel; players get the public game API.
    @admin path_regexp admin (?i)^/+(api/+)?admin(/|$)
    respond @admin 404
    @botsignin path_regexp botsignin (?i)^/+api/+auth/+dev(/|$)
    respond @botsignin 404
    reverse_proxy 127.0.0.1:5280 {
        header_up -CF-Connecting-IP
        header_up X-Real-IP {remote_host}
    }
}
EOF
chmod 0644 /etc/caddy/sites/pokejourneys.caddy
if ! grep -Fxq 'import /etc/caddy/sites/*.caddy' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

if systemctl cat pokejourneys.service >/dev/null 2>&1; then
    systemctl stop pokejourneys.service
    # A copy of the stopped database before every update; the newest 5 are kept.
    if [[ -f /var/lib/pokejourneys/journeys.db ]]; then
        stamp=$(date -u +%Y%m%d-%H%M%S)
        install -d -m 0700 -o pokejourneys -g pokejourneys /var/lib/pokejourneys/pre-update
        for file in journeys.db journeys.db-wal; do
            if [[ -f /var/lib/pokejourneys/$file ]]; then
                cp -p "/var/lib/pokejourneys/$file" "/var/lib/pokejourneys/pre-update/$stamp-$file"
            fi
        done
        ls -1t /var/lib/pokejourneys/pre-update/*-journeys.db | tail -n +6 | while read -r old; do rm -f "$old" "$old-wal"; done
    fi
fi
install -m 0755 "$build/PokeJourneysServer" /opt/pokejourneys/PokeJourneysServer
rsync -rp --delete --chmod=D755,F644 "$build/wwwroot/" /opt/pokejourneys/wwwroot/
# The hub map the bot players walk on (layout.json places, walk.json walkable tiles).
install -d -m 0755 /opt/pokejourneys/hub
for file in layout.json walk.json; do
    if [[ -f "$build/hub/$file" ]]; then install -m 0644 "$build/hub/$file" "/opt/pokejourneys/hub/$file"; fi
done
bots=""
if [[ -f /opt/pokejourneys/hub/layout.json ]]; then bots="$bots --hub-layout /opt/pokejourneys/hub/layout.json"; fi
if [[ -f /opt/pokejourneys/hub/walk.json ]]; then bots="$bots --hub-walk /opt/pokejourneys/hub/walk.json"; fi

cat > /etc/systemd/system/pokejourneys.service <<EOF
[Unit]
Description=PokeJourneys server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pokejourneys
Group=pokejourneys
WorkingDirectory=/opt/pokejourneys
ExecStart=/opt/pokejourneys/PokeJourneysServer --data /var/lib/pokejourneys --urls http://127.0.0.1:5280 --admin-local-only --bot-signin --bots 30$bots
Environment=DOTNET_BUNDLE_EXTRACT_BASE_DIR=/var/lib/pokejourneys/.net
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pokejourneys

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/pokejourneys.service
systemctl daemon-reload
systemctl enable pokejourneys.service
systemctl restart pokejourneys.service

ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
    if curl --fail --silent --output /dev/null --max-time 2 http://127.0.0.1:5280/admin/; then
        ready=true
        break
    fi
    sleep 1
done
if [[ $ready != true ]]; then
    printf 'The server did not become ready. Inspect the private system journal on the VM.\n' >&2
    exit 1
fi
systemctl enable --now caddy.service
systemctl reload caddy.service
printf 'Server installed. Open https://%s/admin/ after DNS and ports 80/443 are ready.\n' "$domain"
