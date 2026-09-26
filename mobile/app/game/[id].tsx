import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useGameStream } from '@/hooks/useGameStream';
import { useV1 } from '@/hooks/useV1';
import { fetchBoxscore, fetchGame, fetchPlays } from '@/lib/api';
import type { GameEvent, V1Boxscore, V1Game, V1PlayerLine, V1Plays, V1TeamLine } from '@/lib/types';

type Tab = 'box' | 'plays' | 'info';

function n(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : String(v);
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  return (
    <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
      {title ? <Text style={[styles.cardTitle, { color: muted }]}>{title}</Text> : null}
      {children}
    </RNView>
  );
}

function Header({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, 'muted');
  const live = game.status.state === 'live';
  return (
    <Card>
      <Text style={[styles.status, { color: live ? brand.live : muted }]}>
        {live ? '● ' : ''}
        {game.status.display}
      </Text>
      <RNView style={styles.scoreRow}>
        <RNView style={styles.team}>
          <Text style={styles.teamName} numberOfLines={2}>
            {game.away.rank ? `${game.away.rank} ` : ''}
            {game.away.shortName || game.away.name}
          </Text>
          <Text style={[styles.record, { color: muted }]}>{game.away.record ?? ''}</Text>
        </RNView>
        <Text style={styles.bigScore}>
          {n(game.away.score)} – {n(game.home.score)}
        </Text>
        <RNView style={[styles.team, { alignItems: 'flex-end' }]}>
          <Text style={[styles.teamName, { textAlign: 'right' }]} numberOfLines={2}>
            {game.home.rank ? `${game.home.rank} ` : ''}
            {game.home.shortName || game.home.name}
          </Text>
          <Text style={[styles.record, { color: muted }]}>{game.home.record ?? ''}</Text>
        </RNView>
      </RNView>
      {game.linescore.length > 0 ? <Linescore game={game} /> : null}
    </Card>
  );
}

function Linescore({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const periods = game.linescore;
  const total = (side: 'home' | 'away') =>
    periods.every((p) => p[side] === null) ? game[side].score : periods.reduce((s, p) => s + (p[side] ?? 0), 0);
  return (
    <RNView style={[styles.linescore, { borderTopColor: border }]}>
      <RNView style={styles.lsRow}>
        <Text style={[styles.lsTeam, { color: muted }]} />
        {periods.map((p) => (
          <Text key={p.period} style={[styles.lsCell, { color: muted }]}>
            {p.period}
          </Text>
        ))}
        <Text style={[styles.lsCell, styles.lsTotal, { color: muted }]}>T</Text>
      </RNView>
      {(['away', 'home'] as const).map((side) => (
        <RNView key={side} style={styles.lsRow}>
          <Text style={styles.lsTeam} numberOfLines={1}>
            {game[side].char6 || game[side].shortName}
          </Text>
          {periods.map((p) => (
            <Text key={p.period} style={styles.lsCell}>
              {n(p[side])}
            </Text>
          ))}
          <Text style={[styles.lsCell, styles.lsTotal]}>{n(total(side))}</Text>
        </RNView>
      ))}
      {game.linescoreSource === 'pbp' ? (
        <Text style={[styles.note, { color: muted }]}>Period scoring rebuilt from play-by-play</Text>
      ) : null}
    </RNView>
  );
}

const TEAM_STATS: { label: string; get: (t: V1TeamLine) => string }[] = [
  { label: 'Shots', get: (t) => n(t.shots) },
  { label: 'Shots on goal', get: (t) => n(t.shotsOnGoal) },
  { label: 'Saves', get: (t) => n(t.saves) },
  { label: 'Ground balls', get: (t) => n(t.groundBalls) },
  { label: 'Faceoffs', get: (t) => (t.faceoffsWon === null ? '–' : `${t.faceoffsWon}-${t.faceoffsWon + (t.faceoffsLost ?? 0)}`) },
  { label: 'Draw controls', get: (t) => n(t.drawControls) },
  { label: 'Clears', get: (t) => (t.clears === null ? '–' : `${t.clears}/${n(t.clearAttempts)}`) },
  { label: 'Turnovers', get: (t) => n(t.turnovers) },
  { label: 'Caused TO', get: (t) => n(t.causedTurnovers) },
  { label: 'EMO', get: (t) => (t.extraMan ? `${t.extraMan.goals}/${t.extraMan.opportunities}` : '–') },
  { label: 'Penalties', get: (t) => (t.penalties ? `${t.penalties.count}/${t.penalties.minutes}m` : '–') },
];

function Boxscore({ box, game }: { box: V1Boxscore; game: V1Game }) {
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const away = box.teams.find((t) => !t.isHome);
  const home = box.teams.find((t) => t.isHome);
  const stat = (teamId: string | undefined) => box.teamStats.find((t) => t.teamId === teamId);
  const a = stat(away?.teamId);
  const h = stat(home?.teamId);
  const isWomen = game.sport === 'lacrosse-women';
  const rows = TEAM_STATS.filter((r) => (isWomen ? r.label !== 'Faceoffs' : r.label !== 'Draw controls'));

  return (
    <>
      <Card title="Team stats">
        <RNView style={[styles.lsRow, { borderBottomColor: border, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 4 }]}>
          <Text style={[styles.statVal, { color: muted }]}>{away?.shortName}</Text>
          <Text style={[styles.statLabel, { color: muted }]} />
          <Text style={[styles.statVal, { color: muted }]}>{home?.shortName}</Text>
        </RNView>
        {rows.map((r) => (
          <RNView key={r.label} style={styles.lsRow}>
            <Text style={styles.statVal}>{a ? r.get(a) : '–'}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>{r.label}</Text>
            <Text style={styles.statVal}>{h ? r.get(h) : '–'}</Text>
          </RNView>
        ))}
        {box.derived.faceoffs === 'pbp' || box.derived.saves === 'pbp' ? (
          <Text style={[styles.note, { color: muted }]}>Faceoffs/saves derived from play-by-play</Text>
        ) : null}
      </Card>
      {[away, home].map((t) =>
        t ? <PlayerTable key={t.teamId} name={t.name} players={box.players.filter((p) => p.teamId === t.teamId)} isWomen={isWomen} /> : null,
      )}
    </>
  );
}

function PlayerTable({ name, players, isWomen }: { name: string; players: V1PlayerLine[]; isWomen: boolean }) {
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const field = players.filter((p) => !p.isGoalie && (p.played || p.points > 0)).sort((x, y) => y.points - x.points || y.goals - x.goals);
  const goalies = players.filter((p) => p.isGoalie && p.played);
  const cols = isWomen ? ['G', 'A', 'P', 'SH', 'GB', 'DC', 'CT'] : ['G', 'A', 'P', 'SH', 'GB', 'FO', 'CT'];
  const val = (p: V1PlayerLine, c: string) =>
    ({
      G: n(p.goals),
      A: n(p.assists),
      P: n(p.points),
      SH: n(p.shots),
      GB: n(p.groundBalls),
      DC: n(p.drawControls),
      FO: p.faceoffsTaken ? `${p.faceoffsWon}-${p.faceoffsTaken}` : '–',
      CT: n(p.causedTurnovers),
    })[c] ?? '–';
  return (
    <Card title={name}>
      <RNView style={[styles.pRow, { borderBottomColor: border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <Text style={[styles.pName, { color: muted }]}>Player</Text>
        {cols.map((c) => (
          <Text key={c} style={[styles.pCell, { color: muted }]}>
            {c}
          </Text>
        ))}
      </RNView>
      {field.map((p) => (
        <RNView key={`${p.number}-${p.name}`} style={styles.pRow}>
          <Text style={styles.pName} numberOfLines={1}>
            {p.number !== null ? `#${p.number} ` : ''}
            {p.name}
          </Text>
          {cols.map((c) => (
            <Text key={c} style={styles.pCell}>
              {val(p, c)}
            </Text>
          ))}
        </RNView>
      ))}
      {goalies.length ? (
        <>
          <RNView style={[styles.pRow, { marginTop: 8, borderBottomColor: border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[styles.pName, { color: muted }]}>Goalie</Text>
            <Text style={[styles.pCell, { color: muted }]}>SV</Text>
            <Text style={[styles.pCell, { color: muted }]}>GA</Text>
          </RNView>
          {goalies.map((p) => (
            <RNView key={`${p.number}-${p.name}`} style={styles.pRow}>
              <Text style={styles.pName} numberOfLines={1}>
                {p.number !== null ? `#${p.number} ` : ''}
                {p.name}
              </Text>
              <Text style={styles.pCell}>{n(p.saves)}</Text>
              <Text style={styles.pCell}>{n(p.goalsAllowed)}</Text>
            </RNView>
          ))}
        </>
      ) : null}
      {field.length === 0 && goalies.length === 0 ? <Text style={[styles.note, { color: muted }]}>No player stats yet.</Text> : null}
    </Card>
  );
}

function Plays({ plays }: { plays: V1Plays }) {
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const team = (id: string | null) => plays.teams.find((t) => t.teamId === id)?.shortName ?? '';
  const ordered = useMemo(() => [...plays.plays].reverse(), [plays.plays]);
  return (
    <Card title="Play-by-play">
      {ordered.length === 0 ? <Text style={[styles.note, { color: muted }]}>No plays yet.</Text> : null}
      {ordered.map((p, i) => {
        const showPeriod = i === 0 || p.period !== ordered[i - 1].period;
        const goal = p.type === 'goal';
        return (
          <RNView key={p.id}>
            {showPeriod ? (
              <Text style={[styles.periodHead, { color: muted, borderBottomColor: border }]}>{p.periodDisplay}</Text>
            ) : null}
            <RNView style={styles.playRow}>
              <Text style={[styles.playClock, { color: muted }]}>{p.clock}</Text>
              <RNView style={{ flex: 1 }}>
                <Text style={[styles.playText, goal && { fontWeight: '700' }]}>
                  {goal ? 'GOAL ' : ''}
                  {team(p.teamId) ? `${team(p.teamId)}: ` : ''}
                  {p.text}
                </Text>
                {goal && p.homeScore !== null ? (
                  <Text style={[styles.note, { color: muted }]}>
                    {p.awayScore} – {p.homeScore}
                    {p.tags.length ? ` · ${p.tags.join(', ')}` : ''}
                  </Text>
                ) : null}
              </RNView>
            </RNView>
          </RNView>
        );
      })}
    </Card>
  );
}

function Info({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, 'muted');
  const rows: [string, string | null][] = [
    ['Venue', game.venue ? `${game.venue.name}${game.venue.city ? ` — ${game.venue.city}, ${game.venue.state}` : ''}` : null],
    ['Attendance', game.attendance !== null ? game.attendance.toLocaleString() : null],
    ['TV', game.broadcast.network],
    ['Start', game.startTime || null],
    ['Round', game.bracket?.roundDescription ?? null],
    ['Conference', game.home.conference],
  ];
  return (
    <Card title="Game info">
      {rows.map(([k, v]) => (
        <RNView key={k} style={styles.lsRow}>
          <Text style={[styles.statLabel, { color: muted, textAlign: 'left', flex: 0, width: 100 }]}>{k}</Text>
          <Text style={{ flex: 1 }}>{v ?? 'Not published'}</Text>
        </RNView>
      ))}
    </Card>
  );
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('box');
  const muted = useThemeColor({}, 'muted');

  const gameQ = useV1<V1Game>(`game/${id}`, useCallback((s: AbortSignal) => fetchGame(id, s), [id]));
  const [patch, setPatch] = useState<GameEvent | null>(null);
  const game = useMemo<V1Game | null>(() => {
    const g = gameQ.data;
    if (!g) return null;
    if (!patch || patch.gameId !== g.id || patch.at <= g.updatedAt) return g;
    return {
      ...g,
      status: patch.status,
      home: { ...g.home, score: patch.home.score },
      away: { ...g.away, score: patch.away.score },
      linescore: patch.linescore ?? g.linescore,
      updatedAt: patch.at,
    };
  }, [gameQ.data, patch]);
  const live = game?.status.state === 'live';

  const boxQ = useV1<V1Boxscore | null>(`box/${id}`, useCallback((s: AbortSignal) => fetchBoxscore(id, s), [id]), live ? 60_000 : null);
  const playsQ = useV1<V1Plays | null>(`plays/${id}`, useCallback((s: AbortSignal) => fetchPlays(id, s), [id]), live ? 60_000 : null);

  const refreshBox = boxQ.refresh;
  const refreshPlays = playsQ.refresh;
  const refreshGame = gameQ.refresh;

  useGameStream(
    { game: id },
    useCallback(
      (ev: GameEvent) => {
        if (ev.type === 'game.details') {
          refreshBox();
          refreshPlays();
          return;
        }
        setPatch(ev);
        if (ev.type === 'game.state') refreshGame();
      },
      [refreshBox, refreshPlays, refreshGame],
    ),
    live || game?.status.state === 'pre',
  );

  const title = game ? `${game.away.char6 || game.away.shortName} at ${game.home.char6 || game.home.shortName}` : 'Game';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.content}>
        {game ? <Header game={game} /> : <Text style={[styles.note, { color: muted, textAlign: 'center' }]}>{gameQ.error ?? 'Loading…'}</Text>}
        <RNView style={{ marginHorizontal: 12 }}>
          <Segmented<Tab>
            options={[
              { key: 'box', label: 'Box score' },
              { key: 'plays', label: 'Plays' },
              { key: 'info', label: 'Info' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </RNView>
        {tab === 'box' && game ? (
          boxQ.data ? (
            <Boxscore box={boxQ.data} game={game} />
          ) : (
            <Card>
              <Text style={[styles.note, { color: muted }]}>{boxQ.loading ? 'Loading box score…' : 'Box score not available for this game.'}</Text>
            </Card>
          )
        ) : null}
        {tab === 'plays' ? (
          playsQ.data ? (
            <Plays plays={playsQ.data} />
          ) : (
            <Card>
              <Text style={[styles.note, { color: muted }]}>{playsQ.loading ? 'Loading plays…' : 'Play-by-play not available for this game.'}</Text>
            </Card>
          )
        ) : null}
        {tab === 'info' && game ? <Info game={game} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingVertical: 8, paddingBottom: 32, gap: 4 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginHorizontal: 12, marginVertical: 6 },
  cardTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  status: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  team: { flex: 1 },
  teamName: { fontSize: 16, fontWeight: '700' },
  record: { fontSize: 12 },
  bigScore: { fontSize: 32, fontWeight: '800', paddingHorizontal: 12, fontVariant: ['tabular-nums'] },
  linescore: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  lsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  lsTeam: { flex: 1, fontWeight: '600' },
  lsCell: { width: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  lsTotal: { fontWeight: '700' },
  statVal: { width: 64, textAlign: 'center', fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { flex: 1, textAlign: 'center', fontSize: 13 },
  pRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  pName: { flex: 1, fontSize: 13 },
  pCell: { width: 36, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  periodHead: { fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 4, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  playRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  playClock: { width: 44, fontSize: 12, fontVariant: ['tabular-nums'], paddingTop: 2 },
  playText: { fontSize: 14 },
  note: { fontSize: 12, marginTop: 6 },
});
