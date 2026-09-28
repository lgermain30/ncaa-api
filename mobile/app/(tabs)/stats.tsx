import { type ReactNode, useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { schoolName } from '@/lib/names';
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
const BOARDS: { key: string; title: string; col: string; mode: Mode; women?: boolean; men?: boolean; asc?: boolean }[] = [
  { key: 'goals', title: 'Goals', col: 'goals', mode: 'players' },
  { key: 'goals', title: 'Goals Per Game', col: 'avg', mode: 'players' },
  { key: 'assists', title: 'Assists', col: 'assists', mode: 'players' },
  { key: 'assists', title: 'Assists Per Game', col: 'avg', mode: 'players' },
  { key: 'points', title: 'Points', col: 'points', mode: 'players' },
  { key: 'points', title: 'Points Per Game', col: 'avg', mode: 'players' },
  { key: 'shot_pct', title: 'Shooting %', col: 'avg', mode: 'players' },
  { key: 'saves', title: 'Saves', col: 'shots_saved', mode: 'players' },
  { key: 'saves', title: 'Save %', col: 'avg', mode: 'players' },
  { key: 'faceoffs', title: 'Faceoffs Won', col: 'faceoffs_won', mode: 'players', men: true },
  { key: 'faceoffs', title: 'Faceoff %', col: 'avg', mode: 'players', men: true },
  { key: 'draws', title: 'Draw Controls', col: 'draws', mode: 'players', women: true },
  { key: 'draws', title: 'Draw Controls Per Game', col: 'avg', mode: 'players', women: true },
  { key: 'ground_balls', title: 'Ground Balls', col: 'ground_balls', mode: 'players' },
  { key: 'ground_balls', title: 'Ground Balls Per Game', col: 'avg', mode: 'players' },
  { key: 'caused_turnovers', title: 'Caused Turnovers', col: 'caused_turnovers', mode: 'players' },
  { key: 'caused_turnovers', title: 'Caused Turnovers Per Game', col: 'avg', mode: 'players' },
  { key: 'offense', title: 'Goals For / Game', col: 'avg', mode: 'teams' },
  { key: 'defense', title: 'Goals Against / Game', col: 'avg', mode: 'teams', asc: true },
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


/** lax.com ranks every board by per-game average; re-rank by the column we actually display. */
function rankBy(rows: LeaderRow[], col: string, asc = false): LeaderRow[] {
  const num = (r: LeaderRow) => Number.parseFloat(r[col] ?? '') || 0;
  return [...rows].sort((a, b) => (asc ? num(a) - num(b) : num(b) - num(a)));
}

const COLLAPSED = 5;
const EXPANDED = 30;

/** CHN-style band: navy title, top 5 rows; tap to expand to 30 with an ✕ to collapse. */
function Band({
  title,
  cols,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  cols?: string[];
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const border = useThemeColor({}, 'border');
  return (
    <RNView style={[styles.board, { borderColor: border }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={expanded ? `Collapse ${title}` : `Expand ${title}`}
        style={[styles.boardHead, { backgroundColor: brand.navy }]}
      >
        <Text style={styles.boardTitle}>{title}</Text>
        <RNView style={styles.boardRight}>
          {cols?.map((c) => (
            <Text key={c} style={styles.boardCol}>
              {c}
            </Text>
          ))}
          {expanded ? <Text style={styles.boardClose}>✕</Text> : null}
        </RNView>
      </Pressable>
      <Pressable onPress={expanded ? undefined : onToggle} disabled={expanded}>
        {children}
      </Pressable>
    </RNView>
  );
}

function Board({
  title,
  col,
  rows,
  mode,
  expanded,
  onToggle,
}: {
  title: string;
  col: string;
  rows: LeaderRow[];
  mode: Mode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const bg = useThemeColor({}, 'background');
  return (
    <Band title={title} expanded={expanded} onToggle={onToggle}>
      {rows.slice(0, expanded ? EXPANDED : COLLAPSED).map((r, i) => (
        <RNView
          key={`${r.player_id ?? r.team_id}-${i}`}
          style={[styles.row, { backgroundColor: i % 2 ? bg : card, borderBottomColor: border }]}
        >
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {mode === 'players' ? r.name : schoolName(r.team_name)}
          </Text>
          {mode === 'players' ? (
            <Text style={styles.team} numberOfLines={1}>
              {schoolName(r.team_name)}
            </Text>
          ) : null}
          <Text style={styles.val} numberOfLines={1}>{r[col] ?? '–'}</Text>
        </RNView>
      ))}
    </Band>
  );
}

function BoxBoard({
  title,
  stat,
  teams,
  expanded,
  onToggle,
}: {
  title: string;
  stat: keyof V1TeamStatTotals;
  teams: V1TeamSeasonStats[];
  expanded: boolean;
  onToggle: () => void;
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
    <Band title={title} cols={['/G', 'TOT']} expanded={expanded} onToggle={onToggle}>
      {rows.slice(0, expanded ? EXPANDED : COLLAPSED).map((t, i) => (
        <RNView key={t.teamId} style={[styles.row, { backgroundColor: i % 2 ? bg : card, borderBottomColor: border }]}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {t.shortName}
          </Text>
          <Text style={styles.team}>{t.games} GP</Text>
          <Text style={styles.val}>{t.perGame[stat].toFixed(1)}</Text>
          <Text style={[styles.val, { color: muted, fontWeight: '500' }]}>{t.totals[stat]}</Text>
        </RNView>
      ))}
    </Band>
  );
}

export default function StatsScreen() {
  const muted = useThemeColor({}, 'muted');
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const [mode, setMode] = useState<Mode>('players');
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key));
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
              return rows?.length ? (
                <Board
                  key={b.title}
                  title={b.title}
                  col={b.col}
                  rows={rankBy(rows, b.col, b.asc)}
                  mode={b.mode}
                  expanded={open === b.title}
                  onToggle={() => toggle(b.title)}
                />
              ) : null;
            })
          : null}
        {mode === 'teams' && teamQ.data
          ? BOX_BOARDS.filter((b) => !(b.men && women)).map((b) => (
              <BoxBoard
                key={b.key}
                title={b.title}
                stat={b.key}
                teams={teamQ.data ?? []}
                expanded={open === b.title}
                onToggle={() => toggle(b.title)}
              />
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
  content: { paddingBottom: 32 },
  note: { fontSize: 12, textAlign: 'center', marginVertical: 8 },
  board: { borderBottomWidth: StyleSheet.hairlineWidth },
  boardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  boardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  boardCol: { color: '#fff', opacity: 0.8, fontSize: 11, fontWeight: '700', width: 56, textAlign: 'right' },
  boardClose: { color: '#fff', fontSize: 15, fontWeight: '800', marginLeft: 4 },
  boardTitle: { color: '#fff', fontWeight: '600', fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 26, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  name: { flex: 1, minWidth: 0, fontSize: 15 },
  team: { width: 84, fontSize: 14 },
  val: { width: 56, textAlign: 'right', fontSize: 15, fontVariant: ['tabular-nums'] },
});
