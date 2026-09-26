import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarSheet } from '@/components/CalendarSheet';
import { ClnLogo } from '@/components/ClnLogo';
import { Chips } from '@/components/Chips';
import { GameRow } from '@/components/GameRow';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useGameDays } from '@/hooks/useGameDays';
import { useGameStream } from '@/hooks/useGameStream';
import { useV1 } from '@/hooks/useV1';
import { addDays, DIVISIONS, fetchGames, SPORTS, todayEt } from '@/lib/api';
import type { Division, GameEvent, Sport, V1Game } from '@/lib/types';

const STATE_ORDER: Record<V1Game['status']['state'], number> = {
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

const CONF_NAMES: Record<string, string> = {
  acc: 'ACC',
  'big-east': 'Big East',
  'big-ten': 'Big Ten',
  'ivy-league': 'Ivy League',
  caa: 'CAA',
  nec: 'NEC',
  maac: 'MAAC',
  'patriot-league': 'Patriot League',
  asun: 'ASUN',
  'atlantic-10': 'Atlantic 10',
  'america-east': 'America East',
};

function confName(slug: string): string {
  return CONF_NAMES[slug] ?? slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Conference games under their conference; everything else under Non-conference. */
function groupByConference(games: V1Game[]): { title: string; data: V1Game[] }[] {
  const groups = new Map<string, V1Game[]>();
  for (const g of games) {
    const conf = g.home.conference && g.home.conference === g.away.conference ? confName(g.home.conference) : null;
    const key = g.bracket?.roundDescription ? `NCAA Tournament · ${g.bracket.roundDescription}` : (conf ?? 'Non-conference');
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Non-conference' ? 1 : b === 'Non-conference' ? -1 : a.localeCompare(b)))
    .map(([title, data]) => ({ title, data }));
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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

export default function ScoresScreen() {
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const [date, setDate] = useState(todayEt());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isToday = date === todayEt();
  const muted = useThemeColor({}, 'muted');
  const tint = useThemeColor({}, 'tint');
  const border = useThemeColor({}, 'border');
  const card = useThemeColor({}, 'card');
  const insets = useSafeAreaInsets();

  const key = `${sport}/${division}/${date}`;
  const board = useV1<V1Game[]>(
    key,
    useCallback((signal: AbortSignal) => fetchGames(sport, division, date, signal), [sport, division, date]),
    isToday ? 60_000 : null,
  );

  // Game-day calendar: the selected date's year plus any year browsed in the picker.
  const [extraYears, setExtraYears] = useState<number[]>([]);
  const years = useMemo(() => {
    const y = +date.slice(0, 4);
    return [...new Set([y, ...extraYears])].sort();
  }, [date, extraYears]);
  const allGameDays = useGameDays(sport, division, years);
  const addYear = useCallback((y: number) => setExtraYears((prev) => (prev.includes(y) ? prev : [...prev, y])), []);

  const [patches, setPatches] = useState<Patches>({ key, byGame: {} });
  const games = useMemo(() => {
    if (!board.data) return [];
    const byGame = patches.key === key ? patches.byGame : {};
    return sortGames(board.data.map((g) => applyPatch(g, byGame[g.id])));
  }, [board.data, patches, key]);
  const sections = useMemo(() => groupByConference(games), [games]);
  const refresh = board.refresh;

  const stream = useGameStream(
    { sport, division, date },
    useCallback(
      (ev: GameEvent) => {
        if (ev.type === 'game.new' || ev.type === 'game.details') {
          refresh();
          return;
        }
        setPatches((p) => ({ key, byGame: { ...(p.key === key ? p.byGame : {}), [ev.gameId]: ev } }));
      },
      [refresh, key],
    ),
    isToday,
  );

  const liveCount = useMemo(() => games.filter((g) => g.status.state === 'live').length, [games]);

  // Nearest game day at or before today, for the empty-state shortcut.
  const latestGameDay = useMemo(() => {
    const today = todayEt();
    return Object.keys(allGameDays).filter((d) => d <= today).sort().pop() ?? null;
  }, [allGameDays]);

  return (
    <View style={styles.screen}>
      <RNView style={[styles.controls, { paddingTop: insets.top + 6, backgroundColor: card, borderBottomColor: border }]}>
        <RNView style={styles.dateRow}>
          <Pressable onPress={() => setCalendarOpen(true)} hitSlop={10} accessibilityLabel="Pick a date" style={styles.calendarBtn}>
            <ClnLogo size={26} />
            <Text style={[styles.calendarText, { color: tint }]}>Calendar</Text>
          </Pressable>
          <Text style={styles.dateText} numberOfLines={1}>
            {sport === 'lacrosse-men' ? 'M' : 'W'}: {prettyDate(date)}
          </Text>
          <RNView style={styles.arrows}>
            <Pressable onPress={() => setDate((d) => addDays(d, -1))} hitSlop={12} accessibilityLabel="Previous day">
              <Text style={[styles.arrow, { color: tint }]}>◀</Text>
            </Pressable>
            <Pressable onPress={() => setDate((d) => addDays(d, 1))} hitSlop={12} accessibilityLabel="Next day">
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
        keyExtractor={(g) => g.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <RNView style={styles.sectionHead}>
            <Text style={styles.sectionTitle} numberOfLines={1}>{section.title}</Text>
            <ClnLogo size={22} />
          </RNView>
        )}
        renderItem={({ item, index, section }) => (
          <GameRow game={item} alt={index % 2 === 1} last={index === section.data.length - 1} />
        )}
        refreshControl={<RefreshControl refreshing={false} onRefresh={board.refresh} />}
        contentContainerStyle={[styles.list, { borderColor: border }]}
        ListEmptyComponent={
          <RNView style={styles.emptyWrap}>
            <Text style={[styles.empty, { color: muted }]}>
              {board.loading ? 'Loading…' : board.error ? `Couldn't load scores (${board.error})` : 'No games on this date.'}
            </Text>
            {!board.loading && !board.error && latestGameDay && latestGameDay !== date ? (
              <Pressable onPress={() => setDate(latestGameDay)} style={[styles.jump, { borderColor: tint }]}>
                <Text style={[styles.jumpText, { color: tint }]}>Go to latest games · {prettyDate(latestGameDay)}</Text>
              </Pressable>
            ) : null}
          </RNView>
        }
        ListFooterComponent={
          <Text style={[styles.footer, { color: isToday && stream.connected ? brand.live : muted }]}>
            {isToday
              ? stream.connected
                ? `● Live updates on${liveCount ? ` · ${liveCount} in progress` : ''}`
                : 'Refreshing every minute'
              : board.stale
                ? 'Showing last saved data'
                : ''}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { paddingBottom: 6, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 4, minHeight: 36 },
  calendarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarText: { fontSize: 19, fontWeight: '500' },
  arrows: { flexDirection: 'row', gap: 14 },
  arrow: { fontSize: 18, paddingHorizontal: 2 },
  dateText: { fontSize: 19, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 10 },
  filterDivider: { width: StyleSheet.hairlineWidth, height: 18 },
  list: { paddingBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: brand.navy },
  sectionTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },
  emptyWrap: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24, gap: 14 },
  empty: { textAlign: 'center' },
  jump: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  jumpText: { fontWeight: '600' },
  footer: { textAlign: 'center', marginTop: 12, fontSize: 12 },
});
