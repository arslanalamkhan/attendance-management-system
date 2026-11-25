# Deploying NACTA Attendance on the datacenter Linux VM

This moves the system from the development PC to a terminal-only Linux VM with internet access.
Supported: **Ubuntu 22.04 / 24.04, Debian 12, RHEL / Rocky / Alma 8-9** (x86_64 or arm64).

```
 Users' browsers ──HTTPS 443──►  nginx ──► Node app (127.0.0.1:4000) ──► PostgreSQL 18 (127.0.0.1:5432)
 ZKTeco terminals ──HTTP 8081──────────►  Node app (ADMS receiver, 0.0.0.0:8081)
```

One systemd service (`nacta-attendance`) runs the web app, the API and the device receiver. nginx only handles HTTPS.
HTTPS is required anyway: browsers allow the webcam (employee photos) only on HTTPS.

## 0. Ask the network team for

| Item | Why |
|---|---|
| VM: 2 vCPU, 4 GB RAM, 40 GB disk; sudo access | the database is ~1.5 GB today and grows with punches and photos |
| A DNS name, e.g. `attendance.nacta.gov.pk`, pointing at the VM | the address users type |
| Firewall: **TCP 443 (and 80)** from the office user networks to the VM | web app |
| Firewall/routing: **TCP 8081** from every terminal's IP/VLAN to the VM | the terminals push punches to the server; the server never connects to them |
| Optional: a certificate from NACTA's internal CA for that DNS name | no browser warning (otherwise a self-signed one is created) |
| Optional: a backup share mounted on the VM | a second copy of the nightly backups |
| Outbound HTTPS from the VM to github.com, deb.nodesource.com / rpm.nodesource.com, apt / download.postgresql.org, registry.npmjs.org | the installer downloads packages |

## 1. On this Windows PC: export the database

From `D:\Attendence` in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\export-database.ps1 -StopServer
```

`-StopServer` stops the app here first, so no new punch lands in the old database. Punches made while you move
stay on the terminal and upload to the new server when it connects. The file is written to `.backup\db\`.

Copy it to the VM (Windows 11 has `scp` built in):

```powershell
scp D:\Attendence\.backup\db\attendance-for-linux-YYYYMMDD-HHMM.dump youruser@VM-IP:/tmp/attendance.dump
```

## 2. On the VM: install

```bash
sudo git clone https://github.com/arslanalamkhan/attendance-management-system.git /opt/nacta-attendance
sudo bash /opt/nacta-attendance/deploy/linux/install.sh \
     --server-name attendance.nacta.gov.pk \
     --restore /tmp/attendance.dump
```

If the repository is private, the clone asks for your GitHub user name and a personal access token (read-only, "Contents"
permission) instead of the password.

Options:

| Option | Meaning |
|---|---|
| `--server-name NAME` | DNS name (or IP) users will type. Default: the VM's IP |
| `--restore FILE` | load the exported database. Without it you get an empty system and a one-time Super Admin password is printed |
| `--cert FILE --key FILE` | use a NACTA CA certificate (PEM) instead of a self-signed one |
| `--skip-firewall` | don't touch ufw / firewalld |

What it does, in order: system packages, Node.js 24, PostgreSQL 18 (from PGDG, the same major version as the PC, so
the dump restores directly), nginx; the `nacta` service account; `/etc/nacta-attendance/attendance.env` with a random
database password; a dedicated database role `nacta_app` (not a superuser); `npm ci` and build; restore or migrate;
the systemd service; HTTPS; the firewall; the nightly backup timer. Running it again is safe.

When it finishes it prints the address. Sign in with your existing Super Admin account (the restored database keeps all
users, roles and passwords).

## 3. Point the terminals at the server

On each SenseFace terminal: **Menu > Comm. > Cloud Server Setting**: Server address = the VM's IP, Port = `8081`,
HTTPS off. Within a minute the device shows as online under **Devices**. Anything punched while it was disconnected
uploads by itself. Do not run the old PC server at the same time.

Check from the VM that the device reaches you: `sudo nacta-attendance logs 50 | grep iclock`.

**If the network blocks port 8081** between the terminals and the VM (common when they are on different subnets),
let the terminal push through port 80 instead. Allow its address once, then set the terminal's port to `80`:

```bash
sudo nacta-attendance allow-device 172.20.35.250     # the terminal's IP; run again for each terminal
sudo nacta-attendance allow-device                   # list the allowed terminals
```

nginx then passes only `/iclock/` requests from those addresses to the app; everything else on port 80 still
redirects to HTTPS. The terminal protocol has no password, so keep the list to the terminals' own addresses.

## 4. Daily administration

```bash
nacta-attendance status                 # service, health, last backup, disk
nacta-attendance logs 300               # recent log lines   (follow: nacta-attendance follow)
sudo nacta-attendance restart
sudo nacta-attendance backup            # extra backup now
sudo nacta-attendance restore FILE      # replace the database (backs up first, asks to type RESTORE)
sudo nacta-attendance update            # git pull + backup + build + migrate + restart
sudo nacta-attendance reset-password admin@nacta.gov.pk   # locked out
```

| Where | What |
|---|---|
| `/opt/nacta-attendance` | the code (git checkout, owned by `nacta`) |
| `/etc/nacta-attendance/attendance.env` | configuration and the database password (mode 640) |
| `/var/backups/nacta-attendance` | nightly backups, 01:30, kept 30 days (`BACKUP_KEEP_DAYS`) |
| `/etc/nginx/conf.d/nacta-attendance.conf`, `/etc/nginx/ssl/` | HTTPS |
| `journalctl -u nacta-attendance` | application logs (rotated by journald) |

## 5. Releasing a new version

On the PC: commit and `git push`. On the VM: `sudo nacta-attendance update`. It takes a backup first, so a bad
release can be undone with `git -C /opt/nacta-attendance checkout <previous commit>` plus
`sudo nacta-attendance update --force`, and the database with `sudo nacta-attendance restore <that backup>`.

## 6. Backups

- Nightly custom-format `pg_dump` (everything: employees, photos, templates, punches, users, the audit log).
- **Keep a copy off the VM.** Mount a backup share and set `BACKUP_COPY_DIR`, or have the backup team collect
  `/var/backups/nacta-attendance`.
- To encrypt them: `sudo sh -c 'openssl rand -base64 32 > /etc/nacta-attendance/backup.pass && chmod 600 /etc/nacta-attendance/backup.pass'`,
  then uncomment `BACKUP_PASSPHRASE_FILE` in the env file. **Store the passphrase somewhere else too**, or the
  backups cannot be restored.
- Test a restore every few months on a spare VM: install with `--restore <backup>`.

## 7. Replacing the certificate

```bash
sudo install -m 644 nacta.crt /etc/nginx/ssl/nacta-attendance.crt   # full chain, PEM
sudo install -m 600 nacta.key /etc/nginx/ssl/nacta-attendance.key
sudo nginx -t && sudo systemctl reload nginx
```

With a trusted certificate in place, enable HSTS by uncommenting `Strict-Transport-Security` in the nginx config.
With the self-signed certificate, users see a warning once per browser; IT can install
`/etc/nginx/ssl/nacta-attendance.crt` as a trusted certificate on office PCs through Group Policy to remove it.

## 8. Security notes

- The app listens on 127.0.0.1 only; only nginx (443) and the device port (8081) are reachable from the network.
  Ask the network team to allow 8081 **only from the terminals' VLAN**.
- The service runs as the unprivileged `nacta` user with a read-only system (`ProtectSystem=strict`).
- The database role `nacta_app` owns only the `attendance` database and can log in only from the VM itself.
- Session cookies are `Secure` + `HttpOnly`; CSRF tokens on every change; sign-in lockout after 5 attempts;
  strict Content-Security-Policy; the audit log is append-only at the database level.
- The ADMS protocol of the terminals is plain HTTP and unauthenticated by design (the device's own limitation);
  keep port 8081 restricted. New terminals register themselves (`ADMS_AUTO_REGISTER=true`); set it to `false`
  in the env file after all terminals are added if you want unknown serial numbers rejected.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| `nacta-attendance status` says health check FAILED | `nacta-attendance logs 100`; a configuration error is printed as one line per problem |
| 502 Bad Gateway in the browser | the app is down: `sudo nacta-attendance restart` |
| Device stays offline | from the device's network, can it reach `VM-IP:8081`? `sudo ss -ltnp | grep 8081`; firewall |
| "Camera needs a secure connection" | open the app with `https://`, not `http://` |
| Times are 5 hours off | the service sets `TZ=Asia/Karachi`; check `ADMS_TIMEZONE=5` and the device's own clock |
