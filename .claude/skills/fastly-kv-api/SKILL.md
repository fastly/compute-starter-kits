---
name: fastly-kv-api
description: Gotchas for calling the Fastly KV Store REST API directly (header names, HEAD support, metadata encoding, key listing/pagination). Use when working on tools/publish-kv or writing any code that PUTs, GETs, HEADs, DELETEs, or lists keys against the real Fastly KV store.
---

# Fastly KV Store REST API

The authoritative reference is the OpenAPI definition in `fastly/api-documentation` (`src/kv_store_item.yaml`), mirrored at the [KV store item docs](https://www.fastly.com/documentation/reference/api/services/resources/kv-store-item/). Check it directly when anything here looks off:

```bash
gh api repos/fastly/api-documentation/contents/src/kv_store_item.yaml --jq '.content' | base64 -d
```

- Item endpoints are `/resources/stores/kv/{store_id}/keys/{key}`; the key listing is `/resources/stores/kv/{store_id}/keys` (no trailing key segment).
- The spec documents `GET`/`PUT`/`DELETE` on the item endpoint — there is no `head:` operation in it. `tools/publish-kv`'s existence/metadata check uses `HEAD` regardless: it returns the same `metadata`/`generation` headers as `GET` with zero body bytes, and the Fastly KV Store team confirmed (2026-07-09) that this is intentional, with public docs to follow.
- Request and response headers use bare, unprefixed names: `metadata` on both the `PUT` request and the `GET` response, plus `if-generation-match` and `time_to_live_sec` on requests and `generation` on responses. (HTTP header names are case-insensitive, so `Metadata:` and `metadata:` are equivalent.)
- Metadata content is a raw UTF-8 string (e.g. plain JSON), not base64-encoded. The spec caps it at 2000 bytes, and since it travels in a header it must contain no CR or LF.
- Key listing is paginated via `cursor`/`limit`/`prefix` query params. Response shape: `{ data: string[], meta: { next_cursor, limit } }` — keep paging while `meta.next_cursor` is present.
