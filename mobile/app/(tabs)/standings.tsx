import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { BoardHeader } from '@/components/BoardHeader';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { conferenceName } from '@/lib/conferences';
import { useV1 } from '@/hooks/useV1';
import { DIVISIONS, fetchStandings, seasonFor, SPORTS, todayEt } from '@/lib/api';
import type { ConferenceStandings, Division, Sport, StandingsRow, V1Envelope } from '@/lib/types';

interface Col {
  key: string;
  label: string;
  width: number;
  value: (r: StandingsRow) => string;
}

function splitRecord(rec: string): [string, string] {
  const [a = '', b = ''] = rec.split('-').map((s) => s.trim());
  return [a, b];
}

function gamesPlayed(rec: string): string {
  const parts = rec.split('-').map((s) => Number.parseInt(s.trim(), 10));
  if (parts.some((n) => Number.isNaN(n))) return '';
  return String(parts.reduce((sum, n) => sum + n, 0));
}

const COLS: Col[] = [
  { key: 'gp', label: 'GP', width: 34, value: (r) => gamesPlayed(r.conferenceRecord) },
  { key: 'w', label: 'W', width: 30, value: (r) => splitRecord(r.conferenceRecord)[0] },
  { key: 'l', label: 'L', width: 30, value: (r) => splitRecord(r.conferenceRecord)[1] },
  { key: 'gf', label: 'GF', width: 38, value: (r) => splitRecord(r.goalsForAgainst)[0] },
  { key: 'ga', label: 'GA', width: 38, value: (r) => splitRecord(r.goalsForAgainst)[1] },
];
const STREAK_COL: Col = { key: 'strk', label: 'STRK', width: 44, value: (r) => r.streak };

export default function StandingsScreen() {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const season = seasonFor(todayEt());
  const { data, error, loading, refresh } = useV1<ConferenceStandings[]>(
    `standings/${sport}/${division}/${season}`,
    useCallback(
      async (signal: AbortSignal): Promise<V1Envelope<ConferenceStandings[]>> => ({
        data: await fetchStandings(sport, division, season, signal),
        meta: { updatedAt: new Date().toISOString(), stale: false },
      }),
      [sport, division, season],
    ),
  );

  const [selected, setSelected] = useState<string | null>(null);
  const conf = useMemo(() => {
    if (!data?.length) return null;
    return data.find((c) => c.slug === selected) ?? data[0];
  }, [data, selected]);
  const cols = useMemo(
    () => (conf?.standings.some((r) => r.streak) ? [...COLS, STREAK_COL] : COLS),
    [conf],
  );

  return (
    <View style={styles.screen}>
      <BoardHeader
        title="Standings"
        sport={sport}
        division={division}
        onSport={setSport}
        onDivision={setDivision}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
        {data?.map((c) => {
          const active = c.slug === conf?.slug;
          return (
            <Pressable
              key={c.slug}
              onPress={() => setSelected(c.slug)}
              style={[styles.chip, active ? { backgroundColor: card, borderColor: border } : null]}>
              <Text style={[styles.chipText, { color: active ? text : muted }]}>{conferenceName(c.conference)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {loading ? <Text style={[styles.note, { color: muted }]}>Loading…</Text> : null}
        {error ? <Text style={[styles.note, { color: muted }]}>Couldn&apos;t load standings ({error})</Text> : null}
        {conf ? (
          <RNView style={[styles.table, { borderColor: border }]}>
            <RNView style={[styles.row, styles.head]}>
              <Text style={[styles.headText, styles.headTeam]}>Team</Text>
              {cols.map((c, i) => (
                <Text key={c.key} style={[styles.cell, styles.headText, { width: c.width, backgroundColor: i % 2 ? '#6c6c70' : '#5a5a5e' }]}>
                  {c.label}
                </Text>
              ))}
            </RNView>
            {conf.standings.map((r, i) => (
              <RNView key={`${r.team}-${i}`} style={[styles.row, { backgroundColor: card, borderColor: border }]}>
                <RNView style={styles.teamCell}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <RNView style={styles.teamText}>
                    <Text style={styles.teamName} numberOfLines={1}>
                      {r.team}
                    </Text>
                    <Text style={[styles.confRecord, { color: muted }]}>Overall {r.overallRecord}</Text>
                  </RNView>
                </RNView>
                {cols.map((c, j) => {
                  const v = c.value(r);
                  const streak = c.key === 'strk';
                  return (
                    <Text
                      key={c.key}
                      style={[
                        styles.cell,
                        styles.cellText,
                        { width: c.width, backgroundColor: j % 2 ? '#f0f0f2' : '#e6e6ea' },
                        streak && v.startsWith('W') ? { color: brand.win, fontWeight: '700' } : null,
                        streak && v.startsWith('L') ? { color: brand.red, fontWeight: '700' } : null,
                      ]}>
                      {v || '–'}
                    </Text>
                  );
                })}
              </RNView>
            ))}
          </RNView>
        ) : null}
        {!loading && !error && !conf ? <Text style={[styles.note, { color: muted }]}>No standings available for {season}.</Text> : null}
        {conf ? (
          <Text style={[styles.note, { color: muted }]}>
            Conference standings · {season} · GP/W/L = conference games, GF/GA = season
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { flexGrow: 0, flexShrink: 0, height: 40 },
  chipsContent: { paddingHorizontal: 12, alignItems: 'center', gap: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  chipText: { fontSize: 13, fontWeight: '700' },
  content: { paddingBottom: 32 },
  note: { fontSize: 11, marginVertical: 8, textAlign: 'center', fontStyle: 'italic' },
  table: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth },
  head: { backgroundColor: '#5a5a5e', borderBottomWidth: 0 },
  headText: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center', paddingVertical: 7 },
  headTeam: { flex: 1 },
  teamCell: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 4, paddingVertical: 5, gap: 6 },
  teamText: { flex: 1 },
  rank: { width: 22, fontSize: 13, fontWeight: '700', color: brand.navy, textAlign: 'right', fontVariant: ['tabular-nums'] },
  teamName: { fontSize: 14, fontWeight: '600' },
  confRecord: { fontSize: 10, fontVariant: ['tabular-nums'] },
  cell: { textAlign: 'center', textAlignVertical: 'center', paddingVertical: 9 },
  cellText: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
