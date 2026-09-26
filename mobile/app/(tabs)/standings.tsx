import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import { useV1 } from '@/hooks/useV1';
import { fetchStandings, seasonFor, todayEt } from '@/lib/api';
import type { ConferenceStandings, V1Envelope } from '@/lib/types';

export default function StandingsScreen() {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const season = seasonFor(todayEt());
  const { data, error, loading, refresh } = useV1<ConferenceStandings[]>(
    `standings/${season}`,
    useCallback(
      async (signal: AbortSignal): Promise<V1Envelope<ConferenceStandings[]>> => ({
        data: await fetchStandings(season, signal),
        meta: { updatedAt: new Date().toISOString(), stale: false },
      }),
      [season],
    ),
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.note, { color: muted }]}>Men&apos;s Division I conference standings · {season}</Text>
        {loading ? <Text style={[styles.note, { color: muted }]}>Loading…</Text> : null}
        {error ? <Text style={[styles.note, { color: muted }]}>Couldn&apos;t load standings ({error})</Text> : null}
        {data?.map((conf) => (
          <RNView key={conf.slug} style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={styles.confTitle}>{conf.conference}</Text>
            <RNView style={[styles.row, { borderBottomColor: border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.team, { color: muted }]}>Team</Text>
              <Text style={[styles.cell, { color: muted }]}>Conf</Text>
              <Text style={[styles.cell, { color: muted }]}>Overall</Text>
              <Text style={[styles.cellSm, { color: muted }]}>Strk</Text>
            </RNView>
            {conf.standings.map((r) => (
              <RNView key={r.team} style={styles.row}>
                <Text style={styles.team} numberOfLines={1}>
                  {r.team}
                </Text>
                <Text style={styles.cell}>{r.conferenceRecord}</Text>
                <Text style={styles.cell}>{r.overallRecord}</Text>
                <Text style={styles.cellSm}>{r.streak}</Text>
              </RNView>
            ))}
          </RNView>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  note: { fontSize: 12, marginBottom: 8, textAlign: 'center' },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 12 },
  confTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  team: { flex: 1, fontSize: 14 },
  cell: { width: 60, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  cellSm: { width: 40, textAlign: 'center', fontSize: 13 },
});
