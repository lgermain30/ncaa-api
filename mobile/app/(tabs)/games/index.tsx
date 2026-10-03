import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View as RNView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalendarSheet } from "@/components/CalendarSheet";
import { ClnLogo } from "@/components/ClnLogo";
import { ConferenceBand } from "@/components/ConferenceBand";
import { Chips } from "@/components/Chips";
import { GameRow } from "@/components/GameRow";
import { Text, View, useThemeColor } from "@/components/Themed";
import { brand } from "@/constants/Colors";
import { useGameDays } from "@/hooks/useGameDays";
import { useGameStream } from "@/hooks/useGameStream";
import { useV1 } from "@/hooks/useV1";
import { addDays, DIVISIONS, fetchGames, SPORTS, todayEt } from "@/lib/api";
import { conferenceName } from "@/lib/conferences";
import { boardKeys, followedOn, highlightFor, homeBoard, teamKey, useFollows } from "@/lib/favorites";
import { useSettings } from "@/lib/settings";
import type { Division, GameEvent, Sport, V1Game } from "@/lib/types";

const STATE_ORDER: Record<V1Game["status"]["state"], number> = {
  live: 0,
  pre: 1,
  final: 2,
  postponed: 3,
  canceled: 4,
};

function sortGames(games: V1Game[]): V1Game[] {
  return [...games].sort(
    (a, b) =>
      STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] ||
      (a.startEpoch ?? 0) - (b.startEpoch ?? 0) ||
      a.home.name.localeCompare(b.home.name),
  );
}

/** Conference games under their conference; everything else under Non-conference. */
const MY_TEAMS = "My Teams";

function groupByConference(
  games: V1Game[],
  mine: Set<string>,
): { title: string; conference: string | null; data: V1Game[] }[] {
  const groups = new Map<string, V1Game[]>();
  const myGames = games.filter(
    (g) => mine.has(teamKey(g.home)) || mine.has(teamKey(g.away)),
  );
  if (myGames.length) groups.set(MY_TEAMS, myGames);
  const slugs = new Map<string, string>();
  for (const g of games) {
    const slug =
      g.home.conference && g.home.conference === g.away.conference
        ? g.home.conference
        : null;
    const key = g.bracket?.roundDescription
      ? `NCAA Tournament · ${g.bracket.roundDescription}`
      : slug
        ? conferenceName(slug)
        : "Non-conference";
    if (slug && !g.bracket?.roundDescription) slugs.set(key, slug);
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === MY_TEAMS
        ? -1
        : b === MY_TEAMS
          ? 1
          : a === "Non-conference"
            ? 1
            : b === "Non-conference"
              ? -1
              : a.localeCompare(b),
    )
    .map(([title, data]) => ({
      title,
      conference: slugs.get(title) ?? null,
      data,
    }));
}

/** Live stream events received since the last full board load, keyed by game id. */
interface Patches {
  key: string;
  byGame: Record<string, GameEvent>;
}

function applyPatch(g: V1Game, ev: GameEvent | undefined): V1Game {
  if (!ev || ev.at <= g.updatedAt) return g;
  return {
    ...g,
    status: ev.status,
    home: { ...g.home, score: ev.home.score },
    away: { ...g.away, score: ev.away.score },
    linescore: ev.linescore ?? g.linescore,
    updatedAt: ev.at,
  };
}

function prettyDate(date: string): string {
  const today = todayEt();
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
}

export default function ScoresScreen() {
  const follows = useFollows();
  const settings = useSettings();
  const [home] = useState(() => homeBoard(follows));
  const [sport, setSport] = useState<Sport>(home.sport);
  const [division, setDivision] = useState<Division>(home.division);
  const [toast, setToast] = useState<string | null>(null);
  const [date, setDate] = useState(todayEt());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isToday = date === todayEt();
  const muted = useThemeColor({}, "muted");
  const tint = useThemeColor({}, "tint");
  const border = useThemeColor({}, "border");
  const card = useThemeColor({}, "card");
  const insets = useSafeAreaInsets();

  const key = `${sport}/${division}/${date}`;
  const board = useV1<V1Game[]>(
    key,
    useCallback(
      (signal: AbortSignal) => fetchGames(sport, division, date, signal),
      [sport, division, date],
    ),
    isToday ? 60_000 : null,
  );

  // Game-day calendar: the selected date's year plus any year browsed in the picker.
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const years = useMemo(() => {
    const y = +date.slice(0, 4);
    return [...new Set([y, ...extraYears])].sort();
  }, [date, extraYears]);
  const allGameDays = useGameDays(sport, division, years);
  const addYear = useCallback(
    (y: number) =>
      setExtraYears((prev) => (prev.includes(y) ? prev : [...prev, y])),
    [],
  );

  const [patches, setPatches] = useState<Patches>({ key, byGame: {} });
  const games = useMemo(() => {
    if (!board.data) return [];
    const byGame = patches.key === key ? patches.byGame : {};
    return sortGames(board.data.map((g) => applyPatch(g, byGame[g.id])));
  }, [board.data, patches, key]);
  const mine = useMemo(
    () => new Set(followedOn(follows, sport, division).map(teamKey)),
    [follows, sport, division],
  );
  const keys = useMemo(() => boardKeys(follows, sport, division), [follows, sport, division]);
  const gamesRef = useRef(games);
  const mineRef = useRef(mine);
  useEffect(() => {
    gamesRef.current = games;
    mineRef.current = mine;
  }, [games, mine]);
  const goalAlerts = settings.inAppGoalAlerts;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const sections = useMemo(
    () => groupByConference(games, mine),
    [games, mine],
  );
  const refresh = board.refresh;

  const stream = useGameStream(
    { sport, division, date },
    useCallback(
      (ev: GameEvent) => {
        if (ev.type === "game.new" || ev.type === "game.details") {
          refresh();
          return;
        }
        if (ev.type === "game.score" && ev.scored && goalAlerts) {
          const g = gamesRef.current.find((x) => x.id === ev.gameId);
          if (g && (mineRef.current.has(teamKey(g.home)) || mineRef.current.has(teamKey(g.away)))) {
            const scorer = ev.scored.side === "home" ? g.home : g.away;
            setToast(
              `GOAL ${scorer.shortName || scorer.name} — ${g.away.shortName || g.away.name} ${ev.away.score ?? 0}, ${g.home.shortName || g.home.name} ${ev.home.score ?? 0}`,
            );
          }
        }
        setPatches((p) => ({
          key,
          byGame: { ...(p.key === key ? p.byGame : {}), [ev.gameId]: ev },
        }));
      },
      [refresh, key, goalAlerts],
    ),
    isToday,
  );

  const liveCount = useMemo(
    () => games.filter((g) => g.status.state === "live").length,
    [games],
  );

  // Nearest game day at or before today, for the empty-state shortcut.
  const latestGameDay = useMemo(() => {
    const today = todayEt();
    return (
      Object.keys(allGameDays)
        .filter((d) => d <= today)
        .sort()
        .pop() ?? null
    );
  }, [allGameDays]);

  return (
    <View style={styles.screen}>
      <RNView
        style={[
          styles.controls,
          {
            paddingTop: insets.top + 6,
            backgroundColor: card,
            borderBottomColor: border,
          },
        ]}
      >
        <RNView style={styles.dateRow}>
          <Pressable
            onPress={() => setCalendarOpen(true)}
            hitSlop={10}
            accessibilityLabel="Pick a date"
            style={styles.calendarBtn}
          >
            <ClnLogo size={26} />
            <Text style={[styles.calendarText, { color: tint }]}>Calendar</Text>
          </Pressable>
          <Text style={styles.dateText} numberOfLines={1}>
            {sport === "lacrosse-men" ? "M" : "W"}: {prettyDate(date)}
          </Text>
          <RNView style={styles.arrows}>
            <Pressable
              onPress={() => setDate((d) => addDays(d, -1))}
              hitSlop={12}
              accessibilityLabel="Previous day"
            >
              <Text style={[styles.arrow, { color: tint }]}>◀</Text>
            </Pressable>
            <Pressable
              onPress={() => setDate((d) => addDays(d, 1))}
              hitSlop={12}
              accessibilityLabel="Next day"
            >
              <Text style={[styles.arrow, { color: tint }]}>▶</Text>
            </Pressable>
          </RNView>
        </RNView>
        <RNView style={styles.filters}>
          <Chips options={SPORTS} value={sport} onChange={setSport} />
          <RNView style={[styles.filterDivider, { backgroundColor: border }]} />
          <Chips options={DIVISIONS} value={division} onChange={setDivision} />
        </RNView>
      </RNView>

      <SectionList
        sections={sections}
        keyExtractor={(g, i) => `${g.id}-${i}`}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <ConferenceBand title={section.title} conference={section.conference} />
        )}
        renderItem={({ item, index, section }) => (
          <GameRow
            game={item}
            alt={index % 2 === 1}
            last={index === section.data.length - 1}
            highlight={[
              highlightFor(item.away, keys.favKeys, keys.watchKeys),
              highlightFor(item.home, keys.favKeys, keys.watchKeys),
            ]}
            bold={settings.boldColors}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={board.refresh} />
        }
        contentContainerStyle={[styles.list, { borderColor: border }]}
        ListEmptyComponent={
          <RNView style={styles.emptyWrap}>
            <Text style={[styles.empty, { color: muted }]}>
              {board.loading
                ? "Loading…"
                : board.error
                  ? `Couldn't load scores (${board.error})`
                  : "No games on this date."}
            </Text>
            {!board.loading &&
            !board.error &&
            latestGameDay &&
            latestGameDay !== date ? (
              <Pressable
                onPress={() => setDate(latestGameDay)}
                style={[styles.jump, { borderColor: tint }]}
              >
                <Text style={[styles.jumpText, { color: tint }]}>
                  Go to latest games · {prettyDate(latestGameDay)}
                </Text>
              </Pressable>
            ) : null}
          </RNView>
        }
        ListFooterComponent={
          <Text
            style={[
              styles.footer,
              { color: isToday && stream.connected ? brand.live : muted },
            ]}
          >
            {isToday
              ? stream.connected
                ? `● Live updates on${liveCount ? ` · ${liveCount} in progress` : ""}`
                : "Refreshing every minute"
              : board.stale
                ? "Showing last saved data"
                : ""}
          </Text>
        }
      />

      <CalendarSheet
        visible={calendarOpen}
        date={date}
        gameDays={allGameDays}
        onSelect={(d) => {
          setDate(d);
          setCalendarOpen(false);
        }}
        onMonthChange={addYear}
        onClose={() => setCalendarOpen(false)}
      />
      {toast ? (
        <Pressable onPress={() => setToast(null)} style={styles.toast} accessibilityRole="alert">
          <Text style={styles.toastText} numberOfLines={2}>{toast}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: brand.live,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toastText: { color: "#fff", fontWeight: "800", fontSize: 14, textAlign: "center" },
  screen: { flex: 1 },
  controls: {
    paddingBottom: 6,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    gap: 4,
    minHeight: 36,
  },
  calendarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  calendarText: { fontSize: 16, fontWeight: "500" },
  arrows: { flexDirection: "row", gap: 14 },
  arrow: { fontSize: 18, paddingHorizontal: 2 },
  dateText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 10,
  },
  filterDivider: { width: StyleSheet.hairlineWidth, height: 18 },
  list: { paddingBottom: 24 },
  emptyWrap: {
    alignItems: "center",
    marginTop: 40,
    paddingHorizontal: 24,
    gap: 14,
  },
  empty: { textAlign: "center" },
  jump: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  jumpText: { fontWeight: "600" },
  footer: { textAlign: "center", marginTop: 12, fontSize: 12 },
});
