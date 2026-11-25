#!/usr/bin/env bash
# NACTA Attendance - one-time installer for a Linux VM (Ubuntu 22.04/24.04, Debian 12, RHEL/Rocky/Alma 8-9).
#
#   sudo git clone https://github.com/arslanalamkhan/attendance-management-system.git /opt/nacta-attendance
#   sudo bash /opt/nacta-attendance/deploy/linux/install.sh --server-name attendance.nacta.gov.pk \
#        [--restore /tmp/attendance.dump] [--cert server.crt --key server.key]
#
# Installs Node.js, PostgreSQL 18 and nginx; creates the "nacta" service account, the database and its own
# database role; builds the app; and sets up the systemd service, HTTPS, the firewall and nightly backups.
# Safe to run again: existing passwords, certificates and data are kept.
set -euo pipefail

APP_DIR=/opt/nacta-attendance
APP_USER=nacta
CONF_DIR=/etc/nacta-attendance
ENV_FILE=$CONF_DIR/attendance.env
NODE_MAJOR=${NODE_MAJOR:-24}
PG_MAJOR=${PG_MAJOR:-18}
ADMS_PORT=8081

SERVER_NAME=""
RESTORE=""
CERT=""
KEY=""
SKIP_FIREWALL=0

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { echo "error: $*" >&2; exit 1; }
info() { echo; echo "==> $*"; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --server-name) SERVER_NAME=${2:-}; shift 2 ;;
    --restore) RESTORE=${2:-}; shift 2 ;;
    --cert) CERT=${2:-}; shift 2 ;;
    --key) KEY=${2:-}; shift 2 ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h | --help) usage ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -f $APP_DIR/package.json && -d $APP_DIR/deploy/linux ]] || die "clone the repository to $APP_DIR first (see the top of this file)"
[[ -z $RESTORE || -f $RESTORE ]] || die "--restore file not found: $RESTORE"
[[ -z $CERT && -z $KEY ]] || [[ -f $CERT && -f $KEY ]] || die "--cert and --key must both point to existing files"
PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[[ -n $SERVER_NAME ]] || SERVER_NAME=${PRIMARY_IP:-localhost}

. /etc/os-release
case "${ID} ${ID_LIKE:-}" in
  *debian* | *ubuntu*) FAMILY=debian ;;
  *rhel* | *fedora* | *centos* | *rocky* | *almalinux*) FAMILY=rhel ;;
  *) die "unsupported distribution: $PRETTY_NAME (supported: Ubuntu, Debian, RHEL, Rocky, Alma)" ;;
esac
echo "Installing NACTA Attendance on $PRETTY_NAME for https://$SERVER_NAME"

# --------------------------------------------------------------------------------------------- packages
info "system packages"
if [[ $FAMILY == debian ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg git nginx openssl
else
  dnf install -y -q ca-certificates curl git nginx openssl policycoreutils-python-utils tar
fi

if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 20 ]]; then
  info "Node.js $NODE_MAJOR (NodeSource)"
  if [[ $FAMILY == debian ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -q nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y -q nodejs
  fi
fi
echo "node $(node -v), npm $(npm -v)"

info "PostgreSQL $PG_MAJOR (PGDG repository)"
if [[ $FAMILY == debian ]]; then
  if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
      >/etc/apt/sources.list.d/pgdg.list
    apt-get update -q
  fi
  apt-get install -y -q "postgresql-$PG_MAJOR"
  PG_SERVICE=postgresql
else
  EL=${VERSION_ID%%.*}
  rpm -q pgdg-redhat-repo >/dev/null 2>&1 ||
    dnf install -y -q "https://download.postgresql.org/pub/repos/yum/reporpms/EL-${EL}-$(uname -m)/pgdg-redhat-repo-latest.noarch.rpm"
  dnf -qy module disable postgresql 2>/dev/null || true
  dnf install -y -q "postgresql${PG_MAJOR}-server"
  if [[ ! -f /var/lib/pgsql/$PG_MAJOR/data/PG_VERSION ]]; then
    "/usr/pgsql-$PG_MAJOR/bin/postgresql-$PG_MAJOR-setup" initdb
  fi
  PG_SERVICE=postgresql-$PG_MAJOR
fi
systemctl enable --now "$PG_SERVICE"

# --------------------------------------------------------------------------------------------- account + config
info "service account and configuration"
id "$APP_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/nacta-attendance --create-home --shell /usr/sbin/nologin "$APP_USER"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
install -d -m 0750 -o root -g "$APP_USER" "$CONF_DIR"

FRESH_ENV=0
if [[ ! -f $ENV_FILE ]]; then
  FRESH_ENV=1
  DB_PASSWORD=$(openssl rand -hex 24)
  SEED_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  cat >"$ENV_FILE" <<EOF
# NACTA Attendance configuration. Read by the systemd service and by the nacta-attendance command.
# After editing: sudo nacta-attendance restart
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
ADMS_PORT=$ADMS_PORT

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=attendance
DB_USER=nacta_app
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgres://nacta_app:$DB_PASSWORD@127.0.0.1:5432/attendance

# The browser address(es) of the app.
CORS_ORIGIN=https://$SERVER_NAME
COOKIE_SECURE=true
# nginx runs on this machine.
TRUST_PROXY=loopback

ADMS_TIMEZONE=5
ADMS_AUTO_REGISTER=true
ADMS_LOG_RAW=true
DEVICE_ONLINE_WINDOW_MS=90000
SESSION_IDLE_MINUTES=30
SESSION_MAX_HOURS=12
LOG_LEVEL=info

# Only used when the database has no Super Admin yet (a fresh install without --restore).
SEED_ADMIN_EMAIL=admin@nacta.gov.pk
SEED_ADMIN_NAME="Super Admin"
SEED_ADMIN_PASSWORD=$SEED_PASSWORD

# Backups (sudo nacta-attendance backup; nightly at 01:30)
BACKUP_KEEP_DAYS=30
# BACKUP_PASSPHRASE_FILE=/etc/nacta-attendance/backup.pass   # encrypt backups (keep a copy of this file elsewhere!)
# BACKUP_COPY_DIR=/mnt/backup-share/nacta-attendance         # also copy each backup to a mounted share
EOF
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

install -m 0755 "$APP_DIR/deploy/linux/nacta-attendance" /usr/local/bin/nacta-attendance
# Reuse the admin command's helpers (load_env, node_script, restore_dump, build_app, wait_healthy).
# shellcheck disable=SC1091
. /usr/local/bin/nacta-attendance
load_env

# --------------------------------------------------------------------------------------------- database
info "database"
role_exists=$(pg_super -At -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")
if [[ $role_exists != 1 ]]; then
  # Through stdin, so the password is not visible in the process list.
  pg_super -q <<<"CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASSWORD';"
fi
# The app connects over TCP to 127.0.0.1 with a password (scram-sha-256), whatever the distribution's default is.
HBA_FILE=$(pg_super -At -c "SHOW hba_file")
if ! grep -q "nacta-attendance" "$HBA_FILE"; then
  tmp=$(mktemp)
  {
    echo "# nacta-attendance: the app's own role, password login from this machine only"
    echo "host    $DB_NAME    $DB_USER    127.0.0.1/32    scram-sha-256"
    echo "host    $DB_NAME    $DB_USER    ::1/128         scram-sha-256"
    cat "$HBA_FILE"
  } >"$tmp"
  cat "$tmp" >"$HBA_FILE"
  rm -f "$tmp"
  pg_super -q -c "SELECT pg_reload_conf()" >/dev/null
fi
db_exists=$(pg_super -At -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")

build_app

if [[ -n $RESTORE ]]; then
  if [[ $db_exists == 1 ]]; then
    tables=$(psql -X -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
    [[ $tables -eq 0 ]] || die "database $DB_NAME already has data; use: sudo nacta-attendance restore $RESTORE"
  fi
  systemctl stop nacta-attendance 2>/dev/null || true
  restore_dump "$RESTORE"
else
  if [[ $db_exists != 1 ]]; then
    pg_super -q \
      -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\" ENCODING 'UTF8' TEMPLATE template0" \
      -c "ALTER DATABASE \"$DB_NAME\" SET timezone TO 'Asia/Karachi'"
  fi
  node_script migrate
fi

# --------------------------------------------------------------------------------------------- service
info "systemd service and nightly backup"
install -m 0644 "$APP_DIR/deploy/linux/nacta-attendance.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/linux/nacta-attendance-backup.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/linux/nacta-attendance-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nacta-attendance-backup.timer
systemctl enable nacta-attendance
systemctl restart nacta-attendance
wait_healthy

# --------------------------------------------------------------------------------------------- https
info "nginx and HTTPS"
install -d -m 0755 /etc/nginx/ssl
if [[ -n $CERT ]]; then
  install -m 0644 "$CERT" /etc/nginx/ssl/nacta-attendance.crt
  install -m 0600 "$KEY" /etc/nginx/ssl/nacta-attendance.key
elif [[ ! -f /etc/nginx/ssl/nacta-attendance.crt ]]; then
  san="DNS:$SERVER_NAME"
  [[ $SERVER_NAME =~ ^[0-9.]+$ ]] && san="IP:$SERVER_NAME"
  [[ -n $PRIMARY_IP && $PRIMARY_IP != "$SERVER_NAME" ]] && san="$san,IP:$PRIMARY_IP"
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -sha256 \
    -subj "/O=NACTA/CN=$SERVER_NAME" -addext "subjectAltName=$san" \
    -keyout /etc/nginx/ssl/nacta-attendance.key -out /etc/nginx/ssl/nacta-attendance.crt 2>/dev/null
  chmod 0600 /etc/nginx/ssl/nacta-attendance.key
  echo "created a self-signed certificate for $san (replace it with a NACTA CA certificate: see docs/DEPLOYMENT.md)"
fi
NGINX_NAMES=$SERVER_NAME
[[ -n $PRIMARY_IP && $PRIMARY_IP != "$SERVER_NAME" ]] && NGINX_NAMES="$NGINX_NAMES $PRIMARY_IP"
sed "s/__SERVER_NAME__/$NGINX_NAMES/" "$APP_DIR/deploy/linux/nginx-nacta-attendance.conf" \
  >/etc/nginx/conf.d/nacta-attendance.conf
[[ -L /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
  setsebool -P httpd_can_network_connect 1
  restorecon -R /etc/nginx/ssl >/dev/null 2>&1 || true
fi
nginx -t
systemctl enable nginx
systemctl reload nginx 2>/dev/null || systemctl restart nginx

# --------------------------------------------------------------------------------------------- firewall
if [[ $SKIP_FIREWALL -eq 0 ]]; then
  info "firewall: 80, 443 (web) and $ADMS_PORT (ZKTeco devices)"
  if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
    ufw allow 80/tcp && ufw allow 443/tcp && ufw allow "$ADMS_PORT/tcp"
  elif systemctl is-active --quiet firewalld; then
    firewall-cmd -q --permanent --add-service=http --add-service=https --add-port="$ADMS_PORT/tcp"
    firewall-cmd -q --reload
  else
    echo "no active ufw/firewalld; make sure the network firewall allows 443 from users and $ADMS_PORT from the devices"
  fi
fi

# --------------------------------------------------------------------------------------------- done
cat <<EOF

========================================================================================================
 NACTA Attendance is running.

   Web app:     https://$SERVER_NAME${PRIMARY_IP:+   (or https://$PRIMARY_IP)}
   Devices:     on each terminal set  Comm. > Cloud Server Setting > Server ${PRIMARY_IP:-<this VM's IP>}, Port $ADMS_PORT
   Admin:       nacta-attendance help
EOF
if [[ -z $RESTORE && $FRESH_ENV -eq 1 ]]; then
  cat <<EOF
   Sign in:     $SEED_ADMIN_EMAIL with the one-time password  $SEED_ADMIN_PASSWORD
                (you must change it at first sign-in; it is also in $ENV_FILE)
EOF
fi
cat <<EOF
========================================================================================================
EOF
