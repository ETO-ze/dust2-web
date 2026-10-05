# Cloudflare asset publication

The public `main` branch now includes the CDN client changes and the two-map
web homepage. Earlier baseline and patch references below describe the October
4 installer release, not the current web source. The published installers still
use the Dust II entry; the Mirage map pool is a web update.

The selected provider is Cloudflare R2 Standard, with `apac` supplied as a bucket
location hint. This is best-effort placement, not a guarantee of Hong Kong
storage or download nodes. The S3 endpoint remains the account endpoint; do not
put `apac` in its hostname. See [data location](https://developers.cloudflare.com/r2/reference/data-location/).

The game URL remains `https://cs2.duskrain.cn/` and its WSS remains on the game
server. The active static download hostname is `downloads.duskrain.cn`.
This migration does not expose or replace the private map selection/game entry.

## Current deployment

On 2026-10-04 the account holder enabled R2. The API now returns HTTP 200 and
the dedicated `dustii-downloads` bucket was created successfully: APAC, Standard,
default jurisdiction. Its read-only CORS policy was written and read back; the
development public domain remains disabled. No payment settings were changed by
the agent. Current OAuth returns 9109 for token-management permissions, so the
account holder supplied an API token that passed live token verification and an
authenticated S3 read probe. The token is consumed in memory only; no credential
was added to the repository, manifests, command arguments or logs. The immutable
private upload is complete: all 3,960 resources and the final public manifest
passed full streamed SHA-256 verification at the authenticated R2 origin. To
create future bucket-scoped credentials use the
[R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2/overview).

The [Pages read-only R2 gateway](../scripts/cdn/pages-gateway/README.md) is live
through the custom subdomain, with active TLS and the production R2 binding.
The account holder added one DNSPod CNAME pointing to
`dustii-downloads-gateway.pages.dev`; DNSPod remains authoritative and existing
game, mail and unrelated records are unchanged. Pages OAuth is stored in the
OS credential store, while the temporary upload token was cleared. Preview
delivery is disabled and unbound. Repository defaults remain disabled so a
future deployment must explicitly pass acceptance before enabling delivery.

Native R2 custom domains have a different full-zone Cloudflare prerequisite;
that route was not used. See [R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
and [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
No paid plan was purchased. Pages Functions share the account's Workers Free
request allowance; a successful deployment does not guarantee unlimited traffic
or a fixed Hong Kong node.

Inventory and publication commands do not activate the game. The separately
reviewed deployment operator described below applies the verified configuration
and client files with backups and automatic rollback.

## Local inventory

Run from the repository. The example release ID is immutable: if any resource
bytes or publication metadata change after uploading, build a new release ID.

```powershell
npm.cmd run cdn:plan -- --release 20261004-cdn-01 --output artifacts/cdn/20261004-cdn-01/cloudflare-plan.json
npm.cmd run cdn:build -- --release-id 20261004-cdn-01 --dry-run
npm.cmd run cdn:publish -- --manifest artifacts/cdn/20261004-cdn-01/release-local-manifest.json --dry-run
```

`cdn:plan` writes proposed API bodies and operator settings only. Public custom
domain access is disabled in the plan until staging is accepted. The cache rule
is a dedicated hostname rule to append after inspecting existing rules; never
replace unrelated rules with a newly generated entrypoint.

`cdn:build` hashes existing source files and writes only local manifests and
small generated metadata. It merges desktop/mobile base resources, explicit
runtime skin/agent/arms/utility/music references, and the first three maps. It
does not copy the large source tree or recursively publish source tools. Source
bindings, transport hashes and any served Inferno derived render proof must
match. A mismatch fails the build instead of mixing incompatible map versions.

The local manifest contains absolute source paths and must remain local. Only
the separately generated public manifest, with source roots and paths removed,
is uploaded. Default local outputs are ignored by Git.

## Upload and verify the R2 origin

Create a dedicated bucket using the plan's `Standard` storage class and `apac`
hint after R2 is enabled. Use a bucket-scoped object read/write token. MCP OAuth
is separate from S3 credentials. Supply `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and optional `R2_SESSION_TOKEN` through the running
process environment or a protected secret runner; do not paste credentials in
source, command arguments, terminal output or commit them to the repository.

For manual local entry, use `cdn:upload-local` with the same manifest, endpoint,
bucket and READY arguments. It verifies source files before prompting, masks both
credential values in the local terminal and keeps them only in process memory.
The ignored `artifacts/cdn/20261004-cdn-01/upload-local.cmd` contains the prepared
non-secret command and can be launched locally. It does not include credentials
or switch game configuration. Do not paste keys into chat.

```powershell
npm.cmd run cdn:publish -- --manifest artifacts/cdn/20261004-cdn-01/release-local-manifest.json --upload --bucket dustii-downloads --endpoint https://ACCOUNT_ID.r2.cloudflarestorage.com --ready artifacts/cdn/20261004-cdn-01/READY.json
```

Replace the non-secret account placeholder with the selected account ID. The
publisher rechecks every local byte size and SHA-256, then performs conditional
PUTs that cannot overwrite existing objects. Existing objects must pass metadata
and full streamed GET/hash verification. Interrupted tasks can be rerun, reusing
verified objects; an interrupted object restarts from its beginning. This is
task-level continuation, not multipart byte-level resume. Individual PUTs are
limited to 5 GiB; oversized objects are rejected before upload.

Bounded concurrency and retries handle availability errors. Corrupted or
incompatible immutable objects fail and require a new release ID. ETags are not
accepted as SHA-256 evidence. The public release manifest is published last,
after every asset verifies, followed by a local `READY.json`. Earlier READY
evidence is archived before a recheck so a failed run cannot retain a current
success marker. No script activates the game or deletes old objects.

Resource responses use `public, max-age=31536000, immutable, no-transform`.
Transport `.gz` objects use `application/octet-stream` and **no**
`Content-Encoding`. The client checks compressed bytes and performs its own
bounded decompression. Cloudflare must preserve those bytes; `no-transform`
prevents supported compression/image rewriting. Configure the dedicated cache
rule to include otherwise uncached resource types.
[No-transform behavior](https://developers.cloudflare.com/cache/concepts/cache-control/).

## Public delivery acceptance

Configure the bucket's read-only CORS rules, exposing size, Range, ETag and
encoding headers for both the public game origin and private port 8443. Do not
permit browser uploads or send credential-bearing resource requests. Preserve
private map access policy when deciding what becomes publicly addressable; CORS
is not authorization. Keep the development public endpoint disabled for the
production bucket unless temporarily and explicitly needed for a test.

After the domain and TLS are active, verify the complete intended release:

```powershell
npm.cmd run cdn:verify -- --manifest artifacts/cdn/20261004-cdn-01/release-local-manifest.json --base https://downloads.duskrain.cn/ --origin https://cs2.duskrain.cn --origin https://cs2.duskrain.cn:8443 --report artifacts/cdn/20261004-cdn-01/PUBLIC-VERIFICATION.json
```

This reads every object's bytes and checks hashes, HTTP headers, both CORS
origins, representative Range requests and the final published manifest. It
rejects transformed gzip bytes, missing/inconsistent metadata and leaked local
fields. Only a passing report includes proposed operator download settings.
Node HTTP checks do not prove browser acceptance. Follow with actual browser
loading, cancellation, persistent-cache reuse, full-map play and real WSS
join/leave. Compare game-server outbound load during downloads. P60 and mainland
network performance still require direct testing.

For a completed local report with intermittent network failures, preserve that
report and use `--resume-report <prior.json>` with a different output path. The
verifier binds every historical full-body proof to the same release inventory,
refreshes the public manifest before reuse, checks HEAD metadata and the exact
recorded ETag at both origins, fully re-reads failed files and Range samples, and
repeats the global checks and final manifest. The new report records historical
failures and separates reused byte proofs from newly hashed bytes. This trusts
the local operator report; it does not authenticate an arbitrary supplied report.
GET/HEAD network errors have at most two extra attempts with a recorded retry
history. HTTP status or integrity failures are not hidden by retries.

Apply only the verified `DUST2_ASSET_DOWNLOAD_BASE` and
`DUSTII_MAP_DOWNLOAD_BASE` values; leave `DUST2_DOWNLOAD_FALLBACK=false` to avoid
silently returning bulk traffic to the game server. Trusted `download-config.json`
is `no-store`. Preserve prior configuration, builds and server assets for
rollback. If activation requires a service restart, wait for rooms, humans and
players all to be zero and recheck at the action boundary.

Bundled Android/Windows assets retain priority. The shared loader now reads the
trusted game-root configuration for Android's installed origin; the Windows
launcher keeps its local optional-resource proxy and reads the fixed game
configuration before mapping downloads internally to the CDN. Loopback browser
CORS does not need to be broadened. Existing installed packages still need an
update; the signed CDN APK and Windows ZIP are published in
[online-v1.2.0-cdn.1](https://github.com/ETO-ze/dust2-web/releases/tag/online-v1.2.0-cdn.1).
The upload tools do not automatically upgrade installed applications. Download
separation does not solve material decoding, GPU preparation, browser memory or
all network latency.

## Verification

```powershell
npm.cmd run cdn:test
node --test tests/download-origin.mjs tests/private-map-download.mjs
```

The tests cover release inventory binding, safe paths, publisher signing and
conditional writes, interrupted/corrupt objects, final-marker ordering, and
read-only public HTTP acceptance. Local/mock tests are distinct from an actual
R2 upload and Cloudflare CDN test.

### Historical staging acceptance on 2026-10-04

- 49 CDN tests and 11 existing download-origin/map-routing tests passed, with no
  skipped tests. The HTTP tests include a real loopback server; S3 behavior uses
  controlled test transports, not the actual Cloudflare account.
- Full release build and publisher dry-run verified 3,960 source files,
  2,517,426,299 bytes. Runtime assets contribute 440,409,537 bytes; map totals
  are Dust II 667,423,461, Mirage 200,904,115 and Inferno 1,208,689,186 bytes.
- Largest object: 50,162,160 bytes. No current object exceeds 100 MB, so the
  whole-object upload/retry strategy is suitable for this inventory.
- Public manifest SHA-256:
  `7013887d0f361cbce94c42009996659230b568a2a70871efa28c5a9f69e06f9e`.
  The public manifest has no source paths/roots or Windows drive paths.
- Later in the same day R2 activation was confirmed and the private APAC bucket
  plus CORS were provisioned/read back. `duskrain.cn` still has no matching zone
  in the authorized account. Later, a user-supplied token passed API verification
  and the S3 read probe; private upload completed with all 3,960 objects and the
  manifest fully hash-verified. Later, the read-only Pages gateway was deployed
  with the private R2 binding. `downloads.duskrain.cn` and TLS became active
  through one DNSPod CNAME; the authoritative nameservers and existing game
  address were preserved. Preview delivery remains disabled and unbound.
- After installed-client fixes and protected local credential input were added,
  75 targeted tests passed without skips. A separate Vite frontend build passed
  at `D:/CodexBuilds/dust2-cdn-activation/web-cdn-01`; this is staged, not deployed
  or incorporated into newly signed APK/Windows packages.
- The compact map inventory assumes `DecompressionStream` support. CDN maps now
  reject unsupported browsers before any map request, with instructions to update
  Chrome, Edge or Android System WebView. Non-CDN sources retain their original
  fallback. Targeted acceptance is now 80/80 passing without skips. A separate
  Vite build passed at `D:/CodexBuilds/dust2-cdn-activation/web-cdn-02`; it remains
  staged and is not incorporated into newly signed APK/Windows packages.

### Public CDN integrity on 2026-10-04

The custom domain completed verification of all 3,960 objects / 2,517,426,299
bytes, both game origins, Range samples, negative requests and the exact final
public manifest. Four initial network failures passed full-byte retries. The
final report explicitly reuses 3,951 recent historical SHA-256 proofs after
fresh dual-origin HEAD/ETag checks, and fully re-hashes nine files / 3,953,408
bytes. The original failed report is retained. A separate 32-check public
gateway smoke test passed cache, raw gzip, CORS, methods and conditional requests.
Staged browser/config-fixture acceptance passed cancellation, real WSS join/
leave, zero JavaScript errors and zero CDN requests on cached re-entry. This is
separate from live client activation and physical P60 acceptance.

The local production operator packages only reviewed client shells and
immutable compiled bundles after a complete verification report. Host-specific
deployment operators and identity reports are not included in this repository.
It checks production process/config/HTML identities, refuses Nginx shutdown
timeouts that would terminate WebSockets, backs up the mutable files, creates
exact GET/HEAD no-store configuration routes, waits for route readiness after a
graceful reload, and commits HTML last. It never restarts the game services.
Failures restore prior HTML/configuration and preserve old bundles.

### Final live acceptance and release on 2026-10-04

CDN activation `20261004T093042Z` passed after an earlier attempt automatically
rolled back. The subsequent `20261004T102018Z` update changed only compiled
client files and HTML; it did not reload Nginx or restart services. All five
game/frontend process identities remained unchanged. Old bundles, source
assets, install packages and backups were retained.

The public build is isolated from the private working tree at the verified
public baseline `8b0f9f68772601237ad1a5385868368e9306edd1`. Its final provenance
records 508 unchanged baseline files and the specific download, preparation and
installer-link changes. Gameplay, HUD and network rules remain unchanged.
Never deploy the private map-selection entry as the public homepage.

The final public entry is `index-GZdBx6gM.js`, and the private entry is
`private-MCB-qRmX.js`. Actual browser tests used the live configuration with no
resource or configuration fixtures. Public cancellation, full-scene play, WSS
join/leave and cached re-entry passed: 948 base files were present, cached
resource payload transfer was zero and a conditional manifest check used 360
bytes. Inferno cold load and fresh-tab cached re-entry passed: 920 SHA-verified
hits, zero original-map payload transfer, and 2,584,323 bytes of specifically
identified fresh metadata. All three private-map bootstraps passed. The owned
test rooms exited and browsers closed.

Earlier cache rechecks ran on a test machine whose C: drive was observed with
only 0.24 GiB free after the run. Repeating on a dedicated D: profile established
normal cache persistence. Initial disk space was not measured. No shared cache
or private-map cache source was changed to resolve this test condition. The
preparation refinement instead waits for cancellable resource prefetch before
starting audio sample loading; AudioContext unlock remains immediate on click.

The signed Android package has version `1.2.0-cdn.1`, code4, original package and
certificate, 343,823,810 bytes, SHA-256
`2660e0578bb7dbb65c54eb01984177cd0e4096f81e68a4aca3f26cbd17d4c180`.
The Windows ZIP has 389,347,097 bytes, SHA-256
`12fc22e94829dc110041d0892633ad600cc8819b23fcc23501114be46cfa073a`.
The release contains a reviewed public source patch, package audit and checksum
list. GitHub's automatically generated Source code archive is the public
baseline; apply the attached patch for the CDN changes. The private branch was
not pushed. Independent offline and GeckoView packages were not changed.

Targeted preparation/cache/download tests passed 38/38. CDN tests passed 77/77.
The local activation operator now has 22 safety tests, including rejecting a
concurrent external HTML edit during readiness and preserving it in rollback.
This last operator hardening was validated locally after deployment; it is not
claimed as the script used for the successful earlier remote operations.
Real browser acceptance is distinct from these tests. Software-rendered browser
results do not establish P60 frame rate, temperature, cover-upgrade acceptance,
mainland download speed or a reduction of gameplay latency.

Both final installer attachments passed anonymous public full-body SHA-256
verification after publication, with unchanged GitHub asset identity before and
after each stream. Android used Node HTTPS after local Python TLS reads failed;
Windows passed its complete streamed verification. Failed transport attempts
were preserved and were never accepted as byte proofs.

On `2026-10-04T11:27:33Z`, the guarded metadata operator updated the three fixed
dist roots, retained backups and preserved all five process identities. The
public and all three private gameplay URLs serve the same final code4 APK
metadata. The gallery homepage has no Android install panel; its metadata file
is retained on disk, while its unused HTTP path remains outside the gallery
router's allowlist. Actual mobile-browser button acceptance passed without
loading a map, joining a room or downloading the APK. Metadata responses retain
their existing `public, max-age=3600` header; the client explicitly fetches them
with `cache: no-store`. Only delivery configuration is claimed as HTTP no-store.
