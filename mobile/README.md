# CLN Lacrosse (mobile)

College Lacrosse News app for iOS and Android, built with Expo (SDK 57) and Expo Router.

All data comes from the CLN data API on Railway (`/v1`), which normalizes official NCAA
scoreboard, box score and play-by-play feeds for men's and women's D1/D2/D3 lacrosse.

## Screens

- **Games** — men's/women's + D1/D2/D3 selector, day navigation, game rows. Today's board
  subscribes to `/v1/stream` (SSE) for instant score/clock/state changes and falls back to
  60s ETag polling when the stream is unavailable.
- **Game** (`app/(tabs)/games/[id].tsx`) — opens on two team rosters when NCAA publishes player
  data. Box Score is in the header, and the bottom navigation remains visible. The score
  header has a period-by-period linescore; Box Score includes team stats (shots, saves,
  faceoffs / draw controls, clears, EMO, penalties), player stats, play-by-play, and game info
  (venue, attendance, TV). Fields NCAA doesn't publish show as "–" / "Not published";
  values rebuilt from play-by-play are labelled.
- **Standings** — men's D1 conference standings from `/official-standings`; women's D1/D2/D3 and men's D2/D3 from `/standings/{sport}/{division}`.
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
