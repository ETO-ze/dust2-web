# Optional R2 download gateway with DNSPod retained

This is a prepared alternative to the native R2 custom-domain plan. It does not
deploy anything, change DNS, enable R2 public access or switch game downloads.
The game remains at `https://cs2.duskrain.cn/`, with its existing WSS server.

Pages can associate a **subdomain** while the parent domain remains on another
DNS provider. Associate `downloads.duskrain.cn` with the Pages project first,
then add one DNSPod CNAME pointing to the project's actual `*.pages.dev` name.
Do not change nameservers. A CNAME without the Pages association fails.
[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)

The Function reads the existing private `dustii-downloads` bucket through the
`DUSTII_DOWNLOADS` binding. No S3/API credential belongs in this gateway. Native
R2 custom domains still require a same-account Cloudflare zone; pending full
zones are not a supported production shortcut. A native partial-zone setup
requires Business/Enterprise. This Pages alternative preserves that original
plan rather than replacing it.
[R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[zone status](https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/),
[DNS setup availability](https://developers.cloudflare.com/dns/zone-setups/)

## Delivery contract

- Only `releases/20261004-cdn-01/assets/…`, the three maps beneath
  `releases/20261004-cdn-01/maps/…`, and the sanitized `release-manifest.json`
  marker are readable. Hidden/sensitive files, scripts, archives, other releases,
  directory listings and arbitrary proxy targets are rejected.
- Only GET, HEAD and read-only OPTIONS are supported. Unknown objects are 404.
  The code never lists, writes or deletes R2 objects.
- The existing clients' single `?v=<12 or 64 hex>` cache-buster is accepted.
  Additional, repeated or encoded query parameters are rejected; the hash never
  changes the immutable key or creates another edge-cache entry.
- Responses preserve the published MIME type and bytes, with
  `public, max-age=31536000, immutable, no-transform` and **no Content-Encoding**.
  This includes `.gz` transport files: they remain `application/octet-stream`
  for the game to decompress and verify itself.
- CORS permits exactly the two game origins, including port 8443, without
  credentials. Responses vary by Origin. Conditional requests, ETag, single byte
  ranges, suffix/open ranges and If-Range are supported. Unsatisfiable ranges
  return 416; unsupported/malformed/multiple ranges are ignored with full 200.
- Cache API stores only complete successful immutable GET responses with neutral
  CORS headers. HEAD, partial responses, preflights and errors cannot poison the
  full-object cache. Lookup applies each request's CORS headers afterward.
- `DELIVERY_ENABLED` defaults to the literal string `false`. Preview settings
  are also false and have no bucket binding. Missing activation/binding is 503.

CORS is not access control. Enabling production makes these asset URLs readable
by anyone who knows them, including through the production `pages.dev` address.
It does not publish game HTML, WSS endpoints, local manifests or the private
game-entry path. Decide whether the three maps' asset bytes may be publicly
addressable before enabling. If they must remain restricted, add and test an
appropriate authorization mechanism first; do not treat obscure URLs as one.
[R2 binding](https://developers.cloudflare.com/pages/functions/bindings/)

## Permissions and deployment sequence

The precise account-level API permission is **Pages Write**; the user API-token
UI calls it **Cloudflare Pages Edit**. R2 Object Read & Write does not grant it.
Scope it to the existing account. The official narrowed Wrangler OAuth flow can
request `account:read`, `user:read` and `pages:write`, with OS-keyring storage;
check the installed CLI's `login --help` before starting an interactive login.
Do not request another pasted token or a Global API Key. The R2 bucket binding
uses its explicit existing name; if provider validation still rejects the
binding, report the exact rejection before expanding authorization.
[Pages project API permission](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/),
[permission names](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

Use this directory's pinned Wrangler 4.147.0. Dependencies are isolated from the
game package. From `scripts/cdn/pages-gateway`:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run build:check
npm.cmd run test:runtime
```

After account authorization and review, a dedicated Direct Upload project can
be created and deployed with the installed CLI. These commands are mutations:

```powershell
npx.cmd --no-install wrangler pages project create dustii-downloads-gateway --production-branch main
npx.cmd --no-install wrangler pages deploy public --project-name dustii-downloads-gateway --branch main
```

Initial deployment remains closed. Read back the production bucket binding and
false activation, and verify 503 on valid object URLs. Avoid attaching the game
repository or private branch to Git integration. Pages advanced mode bundles
`public/_worker.js` and its shared handler; this project's public directory
contains no game package or private source manifests.

Enable only after the immutable R2 publisher has completed every object and
written current `READY.json`. Set production `DELIVERY_ENABLED` to `true`, leave
preview false/no-binding, and deploy the intended configuration. Do not assume
that an unconfigured preview isolates production resources.

First run the complete existing `cdn:verify` against the actual Pages URL from
the game repository. Then associate the custom subdomain in Pages. In DNSPod,
inspect and preserve any records already at `downloads`; add a single CNAME only
if there is no conflict. Use the actual Pages hostname, not `r2.dev`. Wait for
domain and certificate status Active, accounting for any CAA restrictions, and
repeat verification against `https://downloads.duskrain.cn/`.

```powershell
npm.cmd run cdn:verify -- --manifest artifacts/cdn/20261004-cdn-01/release-local-manifest.json --base https://downloads.duskrain.cn/ --origin https://cs2.duskrain.cn --origin https://cs2.duskrain.cn:8443 --report artifacts/cdn/20261004-cdn-01/PAGES-PUBLIC-VERIFICATION.json
```

Only then apply the passing report's proposed download configuration. Keep the
old configuration/build/resources for rollback. A required game-service restart
still waits for rooms, humans and players all to be zero at the action boundary.
No script here performs activation, purchases a plan, or modifies DNS.

## Capacity and validation limits

Pages Functions can use Cache API on custom domains **and `*.pages.dev`**.
An ordinary `workers.dev` R2 Worker cannot provide this Cache API behavior.
Cache API is per data center, ephemeral, and does not use Tiered Cache. A cache
hit in one region does not establish a hit in another region. The gateway emits
`X-DustII-Cache` for actual lookup results; validate repeat cold/warm requests on
the public platform before reporting edge caching as working.
[Cache API availability and limitations](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[R2 Worker example limitation](https://developers.cloudflare.com/r2/examples/cache-api/)

Each Function request counts toward Workers usage even when the handler serves
its own cache hit. Free usage is a shared **100,000 requests/day**, not unlimited
Pages static traffic; R2 storage/operations remain separate. Requests to R2
through this Function are dynamic, so Pages' free unlimited static-asset rule
does not apply. Measure per-load request counts before deciding whether the
Free limit fits. Workers Paid starts at $5/month; do not purchase automatically.
[Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Local evidence: Node tests exercise the allowlist, exact CORS, query compatibility,
conditional/range behavior, cache poisoning prevention and the existing public
verifier over actual loopback HTTP. The pinned Wrangler builds the module, and
local workerd via Miniflare tests a real local R2 binding and Cache API. The
Miniflare HTTP proxy test uses identity transport to isolate Worker framing; it
does not establish how Cloudflare handles real browser compression negotiation.
No remote deployment, TLS, public-cache, browser/P60 or mainland-speed acceptance
has run as part of this preparation. The complete release must still pass byte
hashes/no-encoding checks on the real public origin, followed by browser play,
persistent-cache reuse and real WSS join/leave.

Errors log only fixed event names. Pages runtime logs/live tail should be checked
after staging; no request credentials, arbitrary URL queries or exception text
are logged by the handler. Do not add unsupported Workers observability fields
to a Pages configuration without validating them against its CLI/schema.
