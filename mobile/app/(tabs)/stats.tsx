import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useV1 } from '@/hooks/useV1';
import { DIVISIONS, fetchLeaders, seasonFor, SPORTS, todayEt } from '@/lib/api';
import type { Division, LeaderBoards, LeaderRow, Sport, V1Envelope } from '@/lib/types';

type Mode = 'players' | 'teams';

/** Leader boards from /lax-stats, in display order, with the column to show. */
const BOARDS: { key: string; title: string; col: string; mode: Mode; women?: boolean; men?: boolean }[] = [
  { key: 'goals', title: 'Goals', col: 'goals', mode: 'players' },
  { key: 'goals', title: 'Goals Per Game', col: 'avg', mode: 'players' },
  { key: 'assists', title: 'Assists', col: 'assists', mode: 'players' },
  { key: 'points', title: 'Points', col: 'points', mode: 'players' },
  { key: 'points', title: 'Points Per Game', col: 'avg', mode: 'players' },
  { key: 'shot_pct', title: 'Shooting %', col: 'avg', mode: 'players' },
  { key: 'saves', title: 'Saves', col: 'shots_saved', mode: 'players' },
  { key: 'saves', title: 'Save %', col: 'avg', mode: 'players' },
  { key: 'faceoffs', title: 'Faceoffs Won', col: 'faceoffs_won', mode: 'players', men: true },
  { key: 'draws', title: 'Draw Controls', col: 'draws', mode: 'players', women: true },
  { key: 'ground_balls', title: 'Ground Balls', col: 'ground_balls', mode: 'players' },
  { key: 'caused_turnovers', title: 'Caused Turnovers', col: 'caused_turnovers', mode: 'players' },
  { key: 'offense', title: 'Goals For / Game', col: 'avg', mode: 'teams' },
  { key: 'defense', title: 'Goals Against / Game', col: 'avg', mode: 'teams' },
  { key: 'goaldiff', title: 'Goal Differential', col: 'diff', mode: 'teams' },
];

function titleCase(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function Board({ title, col, rows, mode }: { title: string; col: string; rows: LeaderRow[]; mode: Mode }) {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const bg = useThemeColor({}, 'background');
  return (
    <RNView style={[styles.board, { backgroundColor: card, borderColor: border }]}>
      <RNView style={[styles.boardHead, { backgroundColor: brand.navy }]}>
        <Text style={styles.boardTitle}>{title}</Text>
      </RNView>
      {rows.slice(0, 10).map((r, i) => (
        <RNView key={`${r.player_id ?? r.team_id}-${i}`} style={[styles.row, i % 2 ? { backgroundColor: bg } : null]}>
          <Text style={[styles.rank, { color: muted }]}>{i + 1}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {mode === 'players' ? r.name : titleCase(r.team_name)}
          </Text>
          {mode === 'players' ? (
            <Text style={[styles.team, { color: muted }]} numberOfLines={1}>
              {titleCase(r.team_name)}
            </Text>
          ) : null}
          <Text style={styles.val}>{r[col] ?? '–'}</Text>
        </RNView>
      ))}
    </RNView>
  );
}

export default function StatsScreen() {
  const muted = useThemeColor({}, 'muted');
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const [mode, setMode] = useState<Mode>('players');
  const season = seasonFor(todayEt());

  const q = useV1<LeaderBoards>(
    `leaders/${sport}/${division}/${season}`,
    useCallback(
      async (signal: AbortSignal): Promise<V1Envelope<LeaderBoards>> => ({
        data: await fetchLeaders(sport, division, season, signal),
        meta: { updatedAt: new Date().toISOString(), stale: false },
      }),
      [sport, division, season],
    ),
  );

  const women = sport === 'lacrosse-women';
  const boards = BOARDS.filter((b) => b.mode === mode && !(b.men && women) && !(b.women && !women));

  return (
    <View style={styles.screen}>
      <RNView style={styles.controls}>
        <Segmented options={SPORTS} value={sport} onChange={setSport} />
        <Segmented options={DIVISIONS} value={division} onChange={setDivision} />
        <Segmented<Mode>
          options={[
            { key: 'players', label: 'Players' },
            { key: 'teams', label: 'Teams' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </RNView>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={q.refresh} />}>
        {q.loading ? <Text style={[styles.note, { color: muted }]}>Loading…</Text> : null}
        {q.error ? <Text style={[styles.note, { color: muted }]}>Couldn&apos;t load stats ({q.error})</Text> : null}
        {q.data
          ? boards.map((b) => {
              const rows = q.data?.[b.key];
              return rows?.length ? <Board key={b.title} title={b.title} col={b.col} rows={rows} mode={b.mode} /> : null;
            })
          : null}
        {q.data ? <Text style={[styles.note, { color: muted }]}>{season} season leaders</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, paddingBottom: 4, gap: 8 },
  content: { paddingHorizontal: 12, paddingBottom: 32, gap: 12 },
  note: { fontSize: 12, textAlign: 'center', marginVertical: 8 },
  board: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  boardHead: { paddingHorizontal: 10, paddingVertical: 6 },
  boardTitle: { color: '#fff', fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, gap: 8 },
  rank: { width: 20, fontSize: 13, fontVariant: ['tabular-nums'] },
  name: { flex: 1, fontSize: 14, fontWeight: '600' },
  team: { width: 90, fontSize: 12, textAlign: 'right' },
  val: { width: 52, textAlign: 'right', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
