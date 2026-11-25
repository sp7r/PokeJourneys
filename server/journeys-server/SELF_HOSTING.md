# Host your own PokeJourneys server

## Start on Windows

Download and unzip the Windows server release when available, or install the .NET 10
SDK and run this from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File server/journeys-server/publish.ps1
```

The builds go to `C:/Builds/PokeJourneys/server/win-x64/` and `linux-arm64/`.
Use `-OutputRoot D:/ServerBuilds` to choose another folder outside the repository.
The server includes its runtime and SQLite; no .NET installation is needed to run it.
Keep the `wwwroot` folder beside `PokeJourneysServer.exe`: it contains the admin page.

Double-click `PokeJourneysServer.exe`, or choose a permanent data folder in PowerShell:

```powershell
.\PokeJourneysServer.exe --data "$env:LOCALAPPDATA\PokeJourneysServer"
```

That is also the default data folder on Windows. It holds `journeys.db`,
`admin-key.txt` and `backups/`. Keep it separate from the build folder. Open
<http://127.0.0.1:5280/admin/> and paste the key from `admin-key.txt`. Keep the key
private; the server also prints it on first start. Leave the server window open;
press Ctrl+C to stop it.

For disposable local testing only, use `--seed-demo --dev-signin` with a fresh data
folder. `--discord-api` changes the Discord API address for tests; leave its default
for real players. See [README.md](README.md) for the API and current app integration.

## Let friends connect

On a trusted home network, add `--urls http://0.0.0.0:5280`, allow TCP 5280 through
your computer's firewall, and share `http://YOUR-LAN-IP:5280`.

For the internet, set up HTTPS **before using sign-in or the admin console**. Point
a domain at your home address, run Caddy in front of `127.0.0.1:5280`, and forward
TCP 80 and 443 from your router to Caddy. Keep 5280 private. An HTTPS tunnel to
`http://127.0.0.1:5280` also works, including when port forwarding is unavailable.
Share the public HTTPS address with friends; never share the admin key.

## Backups, restore and updates

The server makes a consistent database backup at startup and every 24 hours,
keeping the newest 14 in the data folder's `backups/`. The admin API's
`POST /api/admin/backup` makes one immediately. Regularly copy `backups/` to another
computer. These database backups do not include the admin key.

To restore, stop the server and save a separate copy of the current data folder.
Copy your chosen backup over `journeys.db`, remove `journeys.db-wal` and
`journeys.db-shm` if present, then restart with the same `--data` path. Keep
`admin-key.txt`; if it is missing, the server creates a new key.

To update, take an off-machine backup, stop the server, replace the executable and
its accompanying `wwwroot` folder, and start it with the same data path. Your data
stays in place. Keep the previous release and a matching database backup for rollback.

## Publishing app releases

Open the admin console (through the SSH tunnel on the Oracle VM), choose **Releases**, and upload the signed
PokeJourneys APK with its version, Android version code and notes. Use a new version and a version code higher
than every previous upload. APKs must be valid ZIP files under 200 MiB. Give an upload reason, then choose
**Publish** and give a reason to make it available. The newest published version code is offered by the app.
The official server URL built into the app supplies updates, including when a player selects another game server.

To roll back the offer, **Unpublish** the newest release with a reason; the previous published one becomes
latest. This changes future offers and does not downgrade installed apps. Releases can be published again.
Every upload and publish/unpublish change is recorded in the audit log.

Share your public HTTPS address followed by `/download` with players for their first install. It shows the latest
published version, notes and download link without sign-in. The API and page work through the existing Caddy
proxy; admin uploads use the private tunnel. APKs are stored in `<data>/releases/<version>.apk` (on Oracle,
`/var/lib/pokejourneys/releases/`), outside the executable folder. Copy this directory to your off-machine backup
alongside database backups: SQLite backups alone do not contain APKs. Keep it in place when updating the server.

## The official server on Oracle Cloud

Create an **Always Free eligible Ampere A1** (`VM.Standard.A1.Flex`) VM in your
home region with Ubuntu 24.04 ARM64 and an SSH key. Stay within the free CPU,
memory and disk allowances shown in your account. Point your domain's DNS at its
public address. Allow inbound TCP 80/443 in Oracle's network rules and the VM
firewall, keep SSH available to your address, and leave 5280 closed to the internet.

### Deploy from your PC

From the repository root on Windows, with the .NET 10 SDK and an SSH key for the VM
(replace the example host and domain; add `-Key path\to\key` if it isn't your default key):

```powershell
powershell -ExecutionPolicy Bypass -File server/journeys-server/deploy/deploy.ps1 -Target ubuntu@VM_IP -Domain journeys.example.com
```

It builds the linux-arm64 server, copies it and `rebuild.sh` to the VM's `/tmp`, runs
`sudo bash /tmp/rebuild.sh /tmp/linux-arm64 journeys.example.com` there, then checks from
your PC that the game API answers and `/admin/` is hidden. The target, domain and key path
are saved in `%LOCALAPPDATA%\PokeJourneysDeploy\oracle.json`, so every later update is the
same command without arguments. The restart takes a few seconds; the app retries calls
that fail meanwhile.

### Manage it from your PC

The admin console and admin API are **not on the internet**: Caddy answers 404 for
`/admin` and `/api/admin`, and the service runs with `--admin-local-only`, so the server
itself also refuses admin requests that came through the proxy. Reach them through an
SSH tunnel:

```powershell
powershell -ExecutionPolicy Bypass -File server/journeys-server/deploy/admin.ps1 -CopyKey
```

It opens a tunnel window (`ssh -N -L 15280:127.0.0.1:5280`), copies the server's admin
key to your clipboard and opens <http://127.0.0.1:15280/admin/>, the same console as on
your PC. `admin.ps1 -Shortcut` puts a **PokeJourneys Admin** shortcut on the desktop: a
double-click opens the tunnel hidden, copies the key and opens the console in its own Edge
app window; closing that window closes the tunnel (`-App` is that mode without the shortcut). Events and raids, mart prices, bans and items change live there, without a
restart. Close the tunnel window when you're done. With Tailscale, give the VM's Tailscale
address as `-Target`; the tunnel works the same. Never open port 5280 to the internet.

### What the script sets up

The script installs the build in `/opt/pokejourneys`, creates the `pokejourneys`
service user and private data folder `/var/lib/pokejourneys`, and enables a
restarting systemd service named `pokejourneys`. It installs Caddy and adds a site
in `/etc/caddy/sites/pokejourneys.caddy`, preserving other sites. The server listens
only on `127.0.0.1:5280`. Caddy's proxy headers follow
[the relay's Caddyfile](../coop-relay/Caddyfile):

```caddyfile
journeys.example.com {
    # The admin console is reached only through an SSH tunnel; players get the public game API.
    @admin path_regexp admin (?i)^/+(api/+)?admin(/|$)
    respond @admin 404
    reverse_proxy 127.0.0.1:5280 {
        header_up -CF-Connecting-IP
        header_up X-Real-IP {remote_host}
    }
}
```

[Caddy obtains and renews HTTPS certificates](https://caddyserver.com/docs/automatic-https).
The admin key is in `/var/lib/pokejourneys/admin-key.txt`, readable only with sudo;
`admin.ps1 -CopyKey` reads it over SSH straight to your clipboard, and `rebuild.sh` never
reads, prints or uploads it. The server's first-start key also goes to its private
system journal. Leave test sign-in, bot players and demo seeding off.

For updates, rerun `deploy.ps1` (or copy a fresh build to `/tmp/linux-arm64` and rerun
`rebuild.sh` by hand). It stops the service, copies the stopped database to
`/var/lib/pokejourneys/pre-update/` (the newest 5 are kept), replaces the build,
restarts it, and leaves data in place. Use `sudo systemctl stop pokejourneys` before restoring a backup, make sure
restored files belong to `pokejourneys:pokejourneys`, then use
`sudo systemctl start pokejourneys`.

Set up a separate backup host with rsync, a private destination folder, and SSH
access from the VM's root account. Verify its host key and test the copy first.
Install cron if needed, then add this to root's crontab (`sudo crontab -e`), replacing
the destination:

```cron
15 3 * * * rsync -az -e 'ssh -o BatchMode=yes' /var/lib/pokejourneys/backups/ backup@BACKUP_HOST:/srv/backups/pokejourneys/
```

This copies only database backups off the VM every night, retaining older remote
copies. Set a retention policy there, monitor failures, and test a restore.
[Oracle may reclaim idle free instances](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
so backups on the VM alone are insufficient. Keep your domain and proxy settings
separately. On a replacement VM, rerun the script, stop the service, restore an
off-VM backup, restart and update DNS; use the new admin key if the old one was lost.
