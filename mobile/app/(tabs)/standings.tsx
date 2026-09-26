import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useV1 } from '@/hooks/useV1';
import { fetchStandings, seasonFor, todayEt } from '@/lib/api';
import type { ConferenceStandings, V1Envelope } from '@/lib/types';

/** "12-3" → [12, 3, ties?] */
function wlt(rec: string): [string, string, string] {
  const [w = '-', l = '-', t] = rec.split('-');
  return [w, l, t ?? ''];
}

export default function StandingsScreen() {
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const bg = useThemeColor({}, 'background');
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

  const [selected, setSelected] = useState<string | null>(null);
  const conf = useMemo(() => {
    if (!data?.length) return null;
    return data.find((c) => c.slug === selected) ?? data[0];
  }, [data, selected]);
  const hasTies = conf?.standings.some((r) => wlt(r.conferenceRecord)[2] || wlt(r.overallRecord)[2]) ?? false;

  return (
    <View style={styles.screen}>
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
            <RNView style={[styles.groupRow, { backgroundColor: brand.navy }]}>
              <Text style={[styles.teamHead, styles.headText]}>Team</Text>
              <Text style={[styles.group, styles.headText]}>Conference</Text>
              <Text style={[styles.group, styles.headText]}>Overall</Text>
              <Text style={[styles.strk, styles.headText]}>Strk</Text>
            </RNView>
            <RNView style={[styles.row, styles.subHead, { borderBottomColor: border }]}>
              <Text style={styles.teamHead} />
              {['W', 'L', hasTies ? 'T' : null, 'W', 'L', hasTies ? 'T' : null].map((h, i) =>
                h ? (
                  <Text key={i} style={[styles.cell, styles.subHeadText, { color: muted }]}>
                    {h}
                  </Text>
                ) : null,
              )}
              <Text style={styles.strk} />
            </RNView>
            {conf.standings.map((r, i) => {
              const [cw, cl, ct] = wlt(r.conferenceRecord);
              const [ow, ol, ot] = wlt(r.overallRecord);
              return (
                <RNView key={r.team} style={[styles.row, i % 2 ? { backgroundColor: bg } : null]}>
                  <Text style={styles.teamCell} numberOfLines={1}>
                    <Text style={{ color: muted }}>{i + 1} </Text>
                    {r.team}
                  </Text>
                  <Text style={[styles.cell, styles.bold]}>{cw}</Text>
                  <Text style={styles.cell}>{cl}</Text>
                  {hasTies ? <Text style={styles.cell}>{ct || '0'}</Text> : null}
                  <Text style={[styles.cell, styles.bold]}>{ow}</Text>
                  <Text style={styles.cell}>{ol}</Text>
                  {hasTies ? <Text style={styles.cell}>{ot || '0'}</Text> : null}
                  <Text style={[styles.strk, styles.strkText, { color: r.streak.startsWith('W') ? brand.win : r.streak.startsWith('L') ? brand.red : muted }]}>
                    {r.streak}
                  </Text>
                </RNView>
              );
            })}
          </RNView>
        ) : null}
        <Text style={[styles.note, { color: muted }]}>Men&apos;s Division I official conference standings.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { flexGrow: 0 },
  chipsContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13, fontWeight: '600' },
  content: { paddingHorizontal: 12, paddingBottom: 32 },
  note: { fontSize: 12, marginVertical: 8, textAlign: 'center' },
  table: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  groupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  headText: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  group: { flex: 1 },
  teamHead: { width: 140 },
  subHead: { borderBottomWidth: StyleSheet.hairlineWidth },
  subHeadText: { fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8 },
  teamCell: { width: 140, fontSize: 14, fontWeight: '600' },
  cell: { flex: 1, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  strk: { width: 40 },
  strkText: { textAlign: 'center', fontSize: 12, fontWeight: '700' },
});
