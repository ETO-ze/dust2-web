# Dedicated game host

The dedicated origin is `https://cs2.duskrain.cn/`. It uses nginx on ports 80/443
and forwards game HTTP/WebSocket traffic to `127.0.0.1:3005`. Existing `/dust2/`
links redirect to the equivalent root path. Large assets are served directly by
nginx from the active release.

The deployment layout is isolated:

- `/opt/dust2-web/incoming`: verified uploaded archives and the receiver script.
- `/opt/dust2-web/releases/<stamp>`: independent, immutable application releases.
- `/opt/dust2-web/current`: atomic symlink to the active release.
- `/opt/dust2-web/backups`: scoped configuration and activation backups.
- `/opt/dust2-runtime/current`: hash-verified Node 22 runtime.
- `/etc/nginx/sites-available/cs2.duskrain.cn`: dedicated virtual host.

Provision a previously inspected empty host through an authenticated root SSH
session. The script contains no credentials:

```sh
python3 /opt/dust2-web/incoming/new-server.py provision --expected-hostname HOSTNAME
```

Provisioning installs the runtime, nginx and Certbot, creates the `dust2-web`
system account, checks the public HTTP challenge route and requests an HTTPS
certificate. The certificate renewal timer and nginx reload hook are enabled.
The game stays stopped; its routes return HTTP 503 until release activation.

After the final local build and tests, use `deploy/package-release.py` to produce a
full release archive. Upload it through SSH/SFTP and activate with its reported
SHA256 and the current dedicated-vhost hash:

```sh
python3 /opt/dust2-web/incoming/new-server.py activate \
  --archive /opt/dust2-web/incoming/ARCHIVE.tar.gz \
  --sha256 ARCHIVE_SHA256 \
  --release RELEASE_STAMP \
  --site-sha256 CURRENT_VHOST_SHA256
```

The receiver rejects traversal, links, duplicate members and oversized archives.
It extracts a separate release, switches the managed symlink, validates local
health with the exact release ID, then opens the public gate and verifies HTTPS
health. A failure restores the previous symlink and environment.

The service runs without root privileges. Initial limits are four rooms, 180%
CPU, a 768 MiB Node heap and a 1 GiB cgroup memory ceiling. These preserve the
tested room count on a two-vCPU host while allowing more memory than the earlier
shared server. Higher room counts require a new CPU/load test.

The old host is independent of this receiver. It is not stopped, redirected or
modified automatically during migration.

## Small final client overlays

`overlay-release.py` verifies the full base archive and a small archive of final
`dist/index.html` / hashed JS and CSS, then streams a new archive in `incoming`.
It never extracts into a live release, never overwrites an output, and reports
the final SHA for the normal receiver activation. Both input hashes and all
member paths/types/sizes are checked. This avoids re-uploading unchanged models.

After new-origin browser and WSS checks, `redirect-old-dust2.py` can migrate only
the old game include. It requires zero humans and zero rooms twice, preserves
homepage/vhost hashes, backs up the include, and rolls back an nginx failure.
The old process is left running for rollback.
