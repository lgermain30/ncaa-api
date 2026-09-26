import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View as RNView } from 'react-native';

import { GameCard } from '@/components/GameCard';
import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
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
    timeZone: 'UTC',
  });
}

export default function ScoresScreen() {
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const [date, setDate] = useState(todayEt());
  const isToday = date === todayEt();
  const muted = useThemeColor({}, 'muted');
  const tint = useThemeColor({}, 'tint');

  const key = `${sport}/${division}/${date}`;
  const board = useV1<V1Game[]>(
    key,
    useCallback((signal: AbortSignal) => fetchGames(sport, division, date, signal), [sport, division, date]),
    isToday ? 60_000 : null,
  );

  const [patches, setPatches] = useState<Patches>({ key, byGame: {} });
  const games = useMemo(() => {
    if (!board.data) return [];
    const byGame = patches.key === key ? patches.byGame : {};
    return sortGames(board.data.map((g) => applyPatch(g, byGame[g.id])));
  }, [board.data, patches, key]);
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

  return (
    <View style={styles.screen}>
      <RNView style={styles.controls}>
        <Segmented options={SPORTS} value={sport} onChange={setSport} />
        <Segmented options={DIVISIONS} value={division} onChange={setDivision} />
        <RNView style={styles.dateRow}>
          <Pressable onPress={() => setDate((d) => addDays(d, -1))} hitSlop={12} accessibilityLabel="Previous day">
            <Text style={[styles.arrow, { color: tint }]}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setDate(todayEt())} disabled={isToday}>
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
            <Text style={[styles.dateSub, { color: muted }]}>{date}</Text>
          </Pressable>
          <Pressable onPress={() => setDate((d) => addDays(d, 1))} hitSlop={12} accessibilityLabel="Next day">
            <Text style={[styles.arrow, { color: tint }]}>›</Text>
          </Pressable>
        </RNView>
      </RNView>

      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => <GameCard game={item} />}
        refreshControl={<RefreshControl refreshing={false} onRefresh={board.refresh} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: muted }]}>
            {board.loading ? 'Loading…' : board.error ? `Couldn't load scores (${board.error})` : 'No games on this date.'}
          </Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  arrow: { fontSize: 32, lineHeight: 34, paddingHorizontal: 12 },
  dateText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  dateSub: { fontSize: 12, textAlign: 'center' },
  list: { paddingBottom: 24 },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  footer: { textAlign: 'center', marginTop: 12, fontSize: 12 },
});
