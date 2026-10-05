# Independent asset delivery

Cloudflare R2 with an APAC location hint and a read-only Pages gateway are live.
Static assets use `downloads.duskrain.cn`; game traffic and WSS remain on
`cs2.duskrain.cn`. The dedicated bucket uses read-only game-origin CORS.
See [CDN automation](CDN-AUTOMATION.md) for the versioned publication tools and
the versioned upload, verification and delivery configuration.

The game server remains authoritative for rooms, players, AI, shooting and
economy. Its WebSocket address is unchanged. Only static resource HTTP requests
can move to a separately configured HTTPS origin. A second hostname pointing to
the same game server does not provide bandwidth isolation.

## Configuration

Both the ordinary game server and private map-library frontend serve a
same-origin `download-config.json`. Configuration is supplied by the operator:

```text
DUST2_ASSET_DOWNLOAD_BASE=https://downloads.example/releases/example/assets/
DUSTII_MAP_DOWNLOAD_BASE=https://downloads.example/releases/example/maps/
DUST2_DOWNLOAD_FALLBACK=false
```

The endpoint emits schema version 1 with `assetBaseURL`, `mapBaseURL`, and
`fallbackToGameServer`. Empty bases preserve existing same-origin delivery.
Only HTTP 404 from an older server means configuration is unavailable; invalid
or unavailable configured endpoints must not silently reroute large downloads
to the game server. HTTPS is required, except for local HTTP test origins.
Players cannot set this address through query parameters or settings imports.

The private page reads configuration from the map-library root before metadata
and navigation loading. Original resource URLs remain the cache identities.
Hash-keyed downloaded objects therefore remain reusable when the download host
changes. All current source, collision and transport version checks still apply.

Installed assets retain priority in Android/Windows local clients. Optional
online assets use the separate origin through the shared verified resource
loader. A packaged client's existing backend/proxy must expose the new
configuration before its optional downloads can use this origin; this change
does not replace or rebuild those installed launchers.

## Mirror layout

Copy only the intended static assets, never repository files, SSH credentials,
server configuration, save data or full server archives.

```text
releases/example/
  assets/                         # Runtime assets and their manifests
  maps/de_dust2/
    map.json                      # Same bytes as signed compiled metadata
    nav.json                      # Same bytes as signed navigation
    render-manifest.json          # Sanitized render file inventory
    transport-manifest.json       # Source-bound compressed transport manifest
    transport/<sha256>.gz
    transport/<sha256>.webp
    render/...                    # Original-only resources not in transport
  maps/de_mirage/...
  maps/de_inferno/...
```

Collision data, masks, groups and policy normally come from the verified
compressed transport. If any file is absent from transport, publish its
original bytes at the original logical relative path as well. The fallback
layout must not become a generic proxy for arbitrary URLs.

Serve a `.gz` transport object as `application/octet-stream` **without** a
`Content-Encoding: gzip` header. The client verifies the compressed bytes before
using its own bounded decompressor; HTTP auto-decompression would break those
hashes. Retain exact original bytes; disable image optimization or other CDN
content rewriting for these versioned objects.

Enable read-only GET/HEAD cross-origin access for the game origins, including
the private origin on port 8443. Expose Content-Length, Content-Range, ETag and
Accept-Ranges. Do not send credentials with mirror requests. Versioned/hash
objects may use immutable caching; configuration uses no-store. Range requests,
HTTP 304, correct missing-file HTTP 404 and no directory listing should be
checked before activation.

## Activation and rollback

1. Upload an immutable version. Verify every intended file size and SHA-256.
2. Exercise real browser CORS, streamed block decompression and cache reuse,
   including cancelled loads, corrupt data and mirror failure.
3. Confirm WSS still joins the original game server; compare game-server
   outbound bandwidth while another player downloads.
4. Change only the trusted delivery configuration after these checks. Keep the
   original server assets and previous frontend for rollback.

Fallback is explicitly opt-in. Default mirror failures stop loading and report
an error, preserving the bandwidth isolation. Enabling fallback deliberately
permits downloads to resume from the game server for availability errors; an
integrity failure is not retried there to hide a bad mirror.

No current configuration is activated until the destination account and domain
are ready and actual remote acceptance passes.
No public/private gameplay services have been restarted for this preparation.

## Local validation on 2026-10-03

- Targeted Node tests: 33 passed, covering delivery configuration, asset and map
  rerouting, cancellation, bounded fallback, integrity checks, installed local
  priority, transport and source cache reuse after changing download origins.
- Actual loopback map-library HTTP audit: 21 checks passed, including the new
  configuration endpoint, GET/HEAD, prefix/Host/method guards, source binding,
  gzip object verification, Range, ETag and rejected corrupted packages.
- Headless Chrome 154 on two independent loopback origins: 7 checks passed.
  Cross-origin assets and gzip blocks passed SHA checks; persistent cache reuse,
  denied CORS and corrupted bytes behaved correctly. No bulk resource request
  reached the game origin in this small fixture.
- Private review Vite build passed in a separate build directory. The existing
  live build and user-installed clients were not overwritten.

Browser evidence is saved at
`D:/CodexBuilds/dust2-download-host/browser-qa.json`. These checks use small
fixtures; they do not establish provider throughput, actual China network
performance, remote WSS connectivity or full-map GPU preparation time. Those
remain part of activation after a destination is selected.

## Provider comparison checked 2026-10-03

- Tencent COS plus CDN is a candidate for predominantly mainland players. CDN
  list pricing below 2 TB/month is CNY 0.21/GB for mainland nodes and CNY 0.46/GB
  for Asia Pacific 1, including Hong Kong. Storage, COS origin traffic and HTTPS
  requests are additional costs, not included in those CDN rates. Mainland or
  global CDN acceleration requires an ICP-filed domain; overseas-only does not.
  [Pricing](https://cloud.tencent.com/document/product/228/2949),
  [domain requirements](https://cloud.tencent.com/document/api/228/3149).
- Cloudflare R2 Standard has 10 GB-month storage, 1 million Class A and 10 million
  Class B operations in its monthly free tier; direct R2 egress has no fee.
  Excess storage is USD 0.015/GB-month. For production delivery use a custom
  domain and explicit cache rules rather than the rate-limited development
  domain. Mainland network performance has not been measured for this game.
  [Pricing](https://developers.cloudflare.com/r2/pricing/),
  [custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/).

The old authorized server was inspected read-only: about 2.83 GB free while
existing services run. The current compressed three-map package alone is about
2.07 GB, so moving the package there without sufficient operating/update reserve
is not recommended. No old service or file was removed.

This migration addresses download contention. It does not remove image-decoding
or GPU-memory costs, and no network latency or device-performance improvement is
claimed before an actual deployment and measured test.
