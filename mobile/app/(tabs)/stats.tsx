import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useV1 } from '@/hooks/useV1';
import { DIVISIONS, fetchLeaders, fetchTeamStats, seasonFor, SPORTS, todayEt } from '@/lib/api';
import type {
  Division,
  LeaderBoards,
  LeaderRow,
  Sport,
  V1Envelope,
  V1TeamSeasonStats,
  V1TeamStatTotals,
} from '@/lib/types';

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

/** Team boards summed from our stored box scores (lax.com doesn't publish these). */
const BOX_BOARDS: { key: keyof V1TeamStatTotals; title: string; men?: boolean }[] = [
  { key: 'shots', title: 'Shots' },
  { key: 'saves', title: 'Saves' },
  { key: 'causedTurnovers', title: 'Caused Turnovers' },
  { key: 'groundBalls', title: 'Ground Balls' },
  { key: 'turnovers', title: 'Turnovers' },
  { key: 'penalties', title: 'Penalties' },
  { key: 'penaltyMinutes', title: 'Penalty Minutes' },
  { key: 'faceoffsWon', title: 'Faceoffs Won', men: true },
  { key: 'clears', title: 'Clears' },
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
          <RNView style={styles.identity}>
            <Text style={styles.name}>{mode === 'players' ? r.name : titleCase(r.team_name)}</Text>
            {mode === 'players' ? <Text style={[styles.team, { color: muted }]}>{titleCase(r.team_name)}</Text> : null}
          </RNView>
          <Text style={styles.val}>{r[col] ?? '–'}</Text>
        </RNView>
      ))}
    </RNView>
  );
}

function BoxBoard({
  title,
  stat,
  teams,
}: {
  title: string;
  stat: keyof V1TeamStatTotals;
  teams: V1TeamSeasonStats[];
}) {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const bg = useThemeColor({}, 'background');
  // Per-game ranks need a real sample: at least half as many box scores as the busiest team.
  const minGames = Math.max(1, Math.ceil(Math.max(0, ...teams.map((t) => t.games)) / 2));
  const rows = teams.filter((t) => t.games >= minGames).sort((a, b) => b.perGame[stat] - a.perGame[stat]);
  // NCAA publishes no ground balls / turnovers for women's lacrosse; skip boards with no data at all.
  if (!rows.length || rows.every((t) => t.totals[stat] === 0)) return null;
  return (
    <RNView style={[styles.board, { backgroundColor: card, borderColor: border }]}>
      <RNView style={[styles.boardHead, styles.boardHeadRow, { backgroundColor: brand.navy }]}>
        <Text style={styles.boardTitle}>{title}</Text>
        <RNView style={styles.boardCols}>
          <Text style={styles.boardCol}>/G</Text>
          <Text style={styles.boardCol}>TOT</Text>
        </RNView>
      </RNView>
      {rows.slice(0, 10).map((t, i) => (
        <RNView key={t.teamId} style={[styles.row, i % 2 ? { backgroundColor: bg } : null]}>
          <Text style={[styles.rank, { color: muted }]}>{i + 1}</Text>
          <RNView style={styles.identity}>
            <Text style={styles.name}>{t.shortName}</Text>
            <Text style={[styles.team, { color: muted }]}>{t.games} GP</Text>
          </RNView>
          <Text style={styles.val}>{t.perGame[stat].toFixed(1)}</Text>
          <Text style={[styles.val, { color: muted, fontWeight: '500' }]}>{t.totals[stat]}</Text>
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

  const teamQ = useV1<V1TeamSeasonStats[]>(
    `team-stats/${sport}/${division}/${season}`,
    useCallback((signal: AbortSignal) => fetchTeamStats(sport, division, season, signal), [sport, division, season]),
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
        {mode === 'teams' && teamQ.data
          ? BOX_BOARDS.filter((b) => !(b.men && women)).map((b) => (
              <BoxBoard key={b.key} title={b.title} stat={b.key} teams={teamQ.data ?? []} />
            ))
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
  boardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  boardCols: { flexDirection: 'row', gap: 8 },
  boardCol: { color: '#fff', opacity: 0.8, fontSize: 11, fontWeight: '700', width: 52, textAlign: 'right' },
  boardTitle: { color: '#fff', fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, gap: 8 },
  rank: { width: 24, fontSize: 13, fontVariant: ['tabular-nums'] },
  identity: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600' },
  team: { fontSize: 12, marginTop: 2 },
  val: { width: 52, textAlign: 'right', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
