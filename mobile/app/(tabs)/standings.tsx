import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useV1 } from '@/hooks/useV1';
import { DIVISIONS, fetchStandings, seasonFor, SPORTS, todayEt } from '@/lib/api';
import type { ConferenceStandings, Division, Sport, V1Envelope } from '@/lib/types';

export default function StandingsScreen() {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const bg = useThemeColor({}, 'background');
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
  return (
    <View style={styles.screen}>
      <RNView style={styles.controls}>
        <Segmented options={SPORTS} value={sport} onChange={setSport} />
        <Segmented options={DIVISIONS} value={division} onChange={setDivision} />
      </RNView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
        {data?.map((c) => {
          const active = c.slug === conf?.slug;
          return (
            <Pressable
              key={c.slug}
              onPress={() => setSelected(c.slug)}
              style={[styles.chip, { borderColor: border, backgroundColor: active ? tint : card }]}>
              <Text style={[styles.chipText, { color: active ? bg : undefined }]}>{c.conference}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {loading ? <Text style={[styles.note, { color: muted }]}>Loading…</Text> : null}
        {error ? <Text style={[styles.note, { color: muted }]}>Couldn&apos;t load standings ({error})</Text> : null}
        {conf ? (
          <RNView style={[styles.table, { backgroundColor: card, borderColor: border }]}>
            <RNView style={[styles.tableHead, { backgroundColor: brand.navy }]}>
              <Text style={styles.tableTitle}>{conf.conference}</Text>
            </RNView>
            {conf.standings.map((r, i) => (
              <RNView key={`${r.team}-${i}`} style={[styles.row, i % 2 ? { backgroundColor: bg } : null]}>
                <RNView style={styles.teamLine}>
                  <Text style={[styles.rank, { color: muted }]}>{i + 1}</Text>
                  <Text style={styles.teamName}>{r.team}</Text>
                </RNView>
                <RNView style={styles.records}>
                  <RNView style={styles.record}>
                    <Text style={[styles.recordLabel, { color: muted }]}>CONF</Text>
                    <Text style={styles.recordValue}>{r.conferenceRecord}</Text>
                  </RNView>
                  <RNView style={styles.record}>
                    <Text style={[styles.recordLabel, { color: muted }]}>OVERALL</Text>
                    <Text style={styles.recordValue}>{r.overallRecord}</Text>
                  </RNView>
                  {r.streak ? (
                    <RNView style={styles.record}>
                      <Text style={[styles.recordLabel, { color: muted }]}>STREAK</Text>
                      <Text style={[styles.recordValue, { color: r.streak.startsWith('W') ? brand.win : r.streak.startsWith('L') ? brand.red : muted }]}>
                        {r.streak}
                      </Text>
                    </RNView>
                  ) : null}
                </RNView>
              </RNView>
            ))}
          </RNView>
        ) : null}
        {!loading && !error && !conf ? <Text style={[styles.note, { color: muted }]}>No standings available for {season}.</Text> : null}
        {conf ? <Text style={[styles.note, { color: muted }]}>{sport === 'lacrosse-men' && division === 'd1' ? 'Official conference standings' : 'Conference standings'} · {season}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { paddingHorizontal: 12, paddingTop: 12, gap: 8 },
  chips: { flexGrow: 0 },
  chipsContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13, fontWeight: '600' },
  content: { paddingHorizontal: 12, paddingBottom: 32 },
  note: { fontSize: 12, marginVertical: 8, textAlign: 'center' },
  table: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tableHead: { paddingHorizontal: 12, paddingVertical: 8 },
  tableTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  teamLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rank: { width: 24, fontSize: 14, fontVariant: ['tabular-nums'] },
  teamName: { flex: 1, fontSize: 16, fontWeight: '700' },
  records: { flexDirection: 'row', paddingLeft: 32, gap: 24, flexWrap: 'wrap' },
  record: { gap: 2 },
  recordLabel: { fontSize: 10, fontWeight: '700' },
  recordValue: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
