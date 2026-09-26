import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { TeamLogo } from '@/components/TeamLogo';
import { Text, View, useThemeColor } from '@/components/Themed';
import { useV1 } from '@/hooks/useV1';
import { DIVISIONS, fetchStandings, seasonFor, SPORTS, todayEt } from '@/lib/api';
import type { ConferenceStandings, Division, Sport, V1Envelope } from '@/lib/types';

interface TeamEntry {
  name: string;
  conference: string;
  record: string;
}

export default function TeamsScreen() {
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const [division, setDivision] = useState<Division>('d1');
  const [search, setSearch] = useState('');
  const season = seasonFor(todayEt());
  const card = useThemeColor({}, 'card');
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');

  const { data, error, loading, refresh } = useV1<ConferenceStandings[]>(
    `teams/${sport}/${division}/${season}`,
    useCallback(
      async (signal: AbortSignal): Promise<V1Envelope<ConferenceStandings[]>> => ({
        data: await fetchStandings(sport, division, season, signal),
        meta: { updatedAt: new Date().toISOString(), stale: false },
      }),
      [sport, division, season],
    ),
  );

  const teams = useMemo(() => (data ?? [])
    .flatMap((conference): TeamEntry[] => conference.standings.map((row) => ({
      name: row.team,
      conference: conference.conference,
      record: row.overallRecord,
    })))
    .filter((team) => team.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [data, search]);

  return (
    <View style={styles.screen}>
      <RNView style={styles.controls}>
        <Segmented options={SPORTS} value={sport} onChange={setSport} />
        <Segmented options={DIVISIONS} value={division} onChange={setDivision} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search teams"
          placeholderTextColor={muted}
          accessibilityLabel="Search teams"
          style={[styles.search, { backgroundColor: card, borderColor: border, color: text }]}
        />
      </RNView>
      <FlatList
        data={teams}
        keyExtractor={(team) => `${team.conference}/${team.name}`}
        renderItem={({ item }) => (
          <RNView style={[styles.row, { backgroundColor: card, borderBottomColor: border }]}>
            <TeamLogo seoName={null} fallback={item.name} size={38} />
            <RNView style={styles.identity}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.conference, { color: muted }]}>{item.conference}</Text>
            </RNView>
            <Text style={styles.record}>{item.record}</Text>
          </RNView>
        )}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: muted }]}>
            {loading ? 'Loading teams…' : error ? `Couldn't load teams (${error})` : search ? 'No matching teams.' : `No teams available for ${season}.`}
          </Text>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, gap: 8 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  list: { paddingBottom: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  identity: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700' },
  conference: { fontSize: 12, marginTop: 2 },
  record: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { textAlign: 'center', marginTop: 40 },
});
