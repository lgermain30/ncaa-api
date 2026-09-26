# CLN Lacrosse (mobile)

College Lacrosse News app for iOS and Android, built with Expo (SDK 54) and Expo Router.

All data comes from the CLN data API on Railway (`/v1`), which normalizes official NCAA
scoreboard, box score and play-by-play feeds for men's and women's D1/D2/D3 lacrosse.

## Screens

- **Scores** — men's/women's + D1/D2/D3 selector, day navigation, game cards. Today's board
  subscribes to `/v1/stream` (SSE) for instant score/clock/state changes and falls back to
  60s ETag polling when the stream is unavailable.
- **Game** (`app/game/[id].tsx`) — score header with period-by-period linescore, team stats
  (shots, saves, faceoffs / draw controls, clears, EMO, penalties), per-player stats and
  goalies, play-by-play, and game info (venue, attendance, TV). Fields NCAA doesn't publish
  show as "–" / "Not published"; values rebuilt from play-by-play are labelled.
- **Standings** — men's D1 conference standings from `/official-standings`.
- **More** — links to the CLN website.

## Development

```bash
npm install
npx expo start          # then press i / a / w
npx expo lint
npx tsc --noEmit
```

Point at a different API with `EXPO_PUBLIC_API_BASE=https://... npx expo start`.

## Layout

- `app/` — routes (Expo Router)
- `lib/api.ts` — typed `/v1` client with ETag / 304 reuse; `lib/types.ts` mirrors the API contract
- `hooks/useV1.ts` — fetch + optional interval refresh; `hooks/useGameStream.ts` — SSE with `Last-Event-ID` resume
- `components/` — `GameCard`, `Segmented`, themed primitives

## Release builds

Native projects are generated (CNG) — configure in `app.json`, build with
`npx eas-cli@latest build` once Apple Developer / Google Play accounts exist.
