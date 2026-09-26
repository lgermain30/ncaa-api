import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View as RNView } from 'react-native';

import { CalendarSheet } from '@/components/CalendarSheet';
import { GameRow } from '@/components/GameRow';
import { Segmented } from '@/components/Segmented';
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
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
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
  const bg = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');

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
      <RNView style={styles.controls}>
        <RNView style={styles.dateRow}>
          <Pressable onPress={() => setCalendarOpen(true)} style={styles.dateBtn} accessibilityLabel="Pick a date">
            <MaterialIcons name="calendar-month" size={22} color={tint} />
            <Text style={[styles.calendarText, { color: tint }]}>Calendar</Text>
          </Pressable>
          <Text style={styles.dateText} numberOfLines={1}>
            {sport === 'lacrosse-men' ? 'M' : 'W'}{division === 'd1' ? '' : division === 'd2' ? ' DII' : ' DIII'}: {prettyDate(date)}
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
          <Segmented options={SPORTS} value={sport} onChange={setSport} />
          <Segmented options={DIVISIONS} value={division} onChange={setDivision} />
        </RNView>
      </RNView>

      <SectionList
        sections={sections}
        keyExtractor={(g) => g.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <RNView style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </RNView>
        )}
        renderItem={({ item, index, section }) => <GameRow game={item} last={index === section.data.length - 1} />}
        SectionSeparatorComponent={() => <RNView style={{ height: 6, backgroundColor: bg }} />}
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
  controls: { paddingTop: 12, paddingBottom: 6, gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, gap: 4 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  calendarText: { fontSize: 13, fontWeight: '700' },
  arrows: { flexDirection: 'row', gap: 14 },
  arrow: { fontSize: 19, paddingHorizontal: 4 },
  dateText: { fontSize: 19, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  filters: { paddingHorizontal: 12, gap: 6 },
  list: { paddingBottom: 24 },
  sectionHead: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#898989' },
  sectionTitle: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  emptyWrap: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24, gap: 14 },
  empty: { textAlign: 'center' },
  jump: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  jumpText: { fontWeight: '600' },
  footer: { textAlign: 'center', marginTop: 12, fontSize: 12 },
});
