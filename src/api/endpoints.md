# atsu.moe (Atsumaru) — reverse-engineered API reference

> Phase 0 notes. Reverse engineered on 2026-06-26 by analyzing the production
> SPA bundle (`https://atsu.moe/assets/index-*.js`) and probing endpoints live.
> No mitmproxy needed — the site is directly reachable and the JS bundle exposes
> every fetch path in cleartext.

## TL;DR

- **Origin:** `https://atsu.moe`
- **Image CDN:** `https://cdn.atsu.moe` (the origin 302-redirects `/static/pages/*` here)
- **Backend:** [Hono](https://hono.dev) RPC API mounted at **`/api`**, plus a
  **Typesense** search proxy mounted at **`/collections`**.
- **Auth:** none required for search, discovery, manga detail, chapter lists, and
  reading. Only social/account features (and `/api/manga/metadata`) need a session.
- **Typesense API key:** **not needed** — search is proxied same-origin and the
  backend injects the key server-side. We just call `/collections/.../search`.

## Required headers

| Header | Value | Notes |
|--------|-------|-------|
| `User-Agent` | a normal browser UA | Cloudflare is friendlier with one. |
| `Referer` | `https://atsu.moe/` | Sent for politeness; **not** strictly enforced on images (tested: images load without it). |

All network calls use a 10s timeout. Be polite: cache aggressively, add small jitter.

---

## 1. Search (Typesense proxy) — keyless

```
GET https://atsu.moe/collections/manga/documents/search
```

Query params (mirrors what the frontend sends):

| Param | Value |
|-------|-------|
| `q` | search text, or `*` to browse all |
| `query_by` | `title,englishTitle,otherNames,authors` |
| `query_by_weights` | `4,3,2,1` |
| `include_fields` | `id,title,englishTitle,poster,posterSmall,posterMedium,type,isAdult,status,year,mbRating,populairty` |
| `filter_by` | `hidden:!=true` (+ `&& isAdult:=false` to hide 18+) |
| `per_page` | e.g. `20` |
| `page` | **1-based** |
| `infix` | `off,off,fallback,off` (only when `q` is a real query) |
| `sort_by` | only when browsing (`q=*`); see sort table below |

**Response:** `{ found: number, hits: [{ document: {...} }] }`
where each `document` has: `id, title, englishTitle, poster, posterSmall,
posterMedium, type, isAdult, status, year, mbRating, populairty`.
Note the API's own typo: the popularity field is **`populairty`** (e.g. `"2.6M"`).

### filter_by field names (from the bundle's filter builder)

| Filter | Syntax |
|--------|--------|
| Genre (include) | `genreIds:=<id>` |
| Genre (exclude) | `genreIds:!=[<id>,...]` |
| Tag | `tagIds:=<id>` |
| Type | `type:=[Manga,Manwha,...]` |
| Status | `status:=[Ongoing,...]` |
| Adult | `isAdult:=false` / `isAdult:=true` |
| Always | `hidden:!=true` |

Genre/tag/type/status IDs come from `/api/explore/availableFilters` (below).

### sort_by options (for browsing, `q=*`)

| Meaning | sort_by |
|---------|---------|
| Title A–Z | `title:asc` |
| Popularity | `views:desc` |
| Trending | `trending:desc` |
| Recently added | `dateAdded:desc` |
| Recently released | `releaseDate:desc` |
| Top rated | `mbRating:desc` |

There is also a `users` collection (`/collections/users/documents/search`) — not used by this tool.

---

## 2. Discovery / browse — `/api/infinite/*` and `/api/home/page`

```
GET https://atsu.moe/api/infinite/<kind>?page=<0-based>&types=Manga,Manwha,Manhua,OEL[&adult=1]
```

`<kind>` ∈ `trending` · `popular` · `recentlyAdded` · `recentlyUpdated` ·
`topRated` · `mostBookmarked` · `mangaRecommendations` · `mangaSimilar` · `continueReading`

> **Gotchas:** `page` is **0-based** here (unlike search). `types` must be set or
> you get an empty list. `adult=1` opts into 18+ content (omit otherwise).

**Response:** `{ items: [ { id, title, image, smallImage, mediumImage, largeImage, isAdult, type, mbRating, views } ] }`
Poster paths here are like `posters/<hash>.jpg` (relative, no `/static/` prefix — see image notes).

```
GET https://atsu.moe/api/home/page?adult=1     ->  { homePage: {...} }   (curated homepage)
GET https://atsu.moe/api/explore/availableFilters
    ->  { genres:[{id,name}], tags:[{id,name}], types:[{id,name}], statuses:[{id,name}] }
```
21 genres (Action=39, Adventure=37, Comedy=6, Drama=31, Fantasy=36, ...);
types = Manga / Manwha (Manhwa) / Manhua / OEL; statuses = Ongoing/Completed/Hiatus/Canceled.

---

## 3. Manga detail + chapters

```
GET https://atsu.moe/api/manga/info?mangaId=<id>
```
**Response:** `{ id, title, type, forceStrip, chapters: [ { id, title, number, index, pageCount, scanId } ] }`
- `chapters` is **ascending** by `number` (1 → N).
- `scanId` = scanlation release id (a.k.a. `scanlationMangaId`).
- This already includes the full chapter list, so it's all the reader needs.

```
GET https://atsu.moe/api/manga/allChapters?mangaId=<id>
```
**Response:** `{ chapters: [ { id, scanlationMangaId, title, number, createdAt, index, pageCount, progress } ] }`
- **Descending** by number (newest first). Adds `createdAt` (epoch ms) and `progress`.
- Use this if you want upload dates; otherwise prefer `info`.

```
GET https://atsu.moe/api/manga/metadata?mangaId=<id>      ->  401 (requires auth)
```
Description / per-manga genres live behind login. Not used; title + chapters come from `info`,
and cover + rating + status + year come from the search document.

```
GET https://atsu.moe/api/manga/chapters?id=<id>&filter=<...>&sort=<...>&page=<n>
```
Paginated chapter list. Requires valid `filter`/`sort` values (empty → 400). Not used (info is simpler).

---

## 4. Reader — chapter pages

```
GET https://atsu.moe/api/read/chapter?mangaId=<id>&chapterId=<id>
```
**Response:**
```json
{ "readChapter": {
    "id": "...", "title": "...", "scanlationMangaId": "...",
    "pages": [ { "id": "...-0", "image": "/static/pages/<scanId>/<chapterId>/0.webp",
                 "number": 0, "width": 1920, "height": 1080, "aspectRatio": 1.777 } ]
} }
```
Pages already carry their image paths, so no URL construction is needed.

---

## 5. Image format & URL resolution

Two relative shapes appear in responses:
- Search: `poster = "/static/posters/<hash>.jpg"` (leading `/static/`)
- Discovery: `image  = "posters/<hash>.jpg"` (no prefix)
- Pages: `image  = "/static/pages/<scanId>/<chapterId>/<n>.webp"`

**Resolution rule** (`resolveAssetUrl` in `client.ts`):
1. Already absolute (`http...`) → use as-is.
2. Ensure a leading `/`, then ensure a leading `/static/`.
3. Prefix with the origin `https://atsu.moe`.

`/static/pages/*` returns **302 → `https://cdn.atsu.moe/static/pages/...`** (the actual
`image/webp`). `fetch` follows redirects by default, so hitting the origin works for both
posters (served directly, 200) and pages (redirected to the CDN). Page images are **WebP**.

---

## Endpoint inventory (full RPC surface, for reference)

The Hono client exposes far more than we use. Read-only highlights:
`home.page`, `home.popularLists`, `infinite.{trending,popular,recentlyAdded,recentlyUpdated,topRated,mostBookmarked,mangaRecommendations,mangaSimilar,continueReading}`,
`explore.availableFilters`, `browse.{author,lists}`, `search.popular`,
`manga.{info,allChapters,chapters,metadata,featuredLists}`, `read.chapter`.
Everything under `auth.*`, `user.*`, `comments.*`, `forum.*`, `groups.*`, `mod.*`,
`notifications.*`, `list.*`, `downloads.*` requires a session and is out of scope.

## Client-side routes (for `--browser` mode)

- Manga page: `https://atsu.moe/manga/<mangaId>`
- Reader page: `https://atsu.moe/read/<mangaId>/<chapterId>`
