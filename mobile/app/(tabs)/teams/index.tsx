import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View as RNView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chips } from "@/components/Chips";
import { ClnLogo } from "@/components/ClnLogo";
import { TeamLogo } from "@/components/TeamLogo";
import { Text, View, useThemeColor } from "@/components/Themed";
import { useV1 } from "@/hooks/useV1";
import { DIVISIONS, fetchTeams, SPORTS } from "@/lib/api";
import type { Division, Sport, V1TeamSummary } from "@/lib/types";

export default function TeamsScreen() {
  const [sport, setSport] = useState<Sport>("lacrosse-men");
  const [division, setDivision] = useState<Division>("d1");
  const [search, setSearch] = useState("");
  const card = useThemeColor({}, "card");
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const text = useThemeColor({}, "text");
  const bg = useThemeColor({}, "background");
  const insets = useSafeAreaInsets();

  const { data, error, loading, refresh } = useV1<V1TeamSummary[]>(
    `teams/${sport}/${division}`,
    useCallback(
      (signal: AbortSignal) => fetchTeams(sport, division, signal),
      [sport, division],
    ),
  );

  const teams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.conference ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <View style={styles.screen}>
      <RNView
        style={[
          styles.controls,
          {
            paddingTop: insets.top + 6,
            backgroundColor: card,
            borderBottomColor: border,
          },
        ]}
      >
        <RNView style={styles.titleRow}>
          <ClnLogo size={26} />
          <Text style={styles.title}>Teams</Text>
          <RNView style={{ width: 26 }} />
        </RNView>
        <RNView style={styles.filters}>
          <Chips options={SPORTS} value={sport} onChange={setSport} />
          <RNView style={[styles.filterDivider, { backgroundColor: border }]} />
          <Chips options={DIVISIONS} value={division} onChange={setDivision} />
        </RNView>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search teams"
          placeholderTextColor={muted}
          accessibilityLabel="Search teams"
          clearButtonMode="while-editing"
          style={[
            styles.search,
            { backgroundColor: bg, borderColor: border, color: text },
          ]}
        />
      </RNView>
      <FlatList
        data={teams}
        keyExtractor={(t) => t.id}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/teams/[id]",
                params: {
                  id: item.id,
                  sport,
                  division,
                  seoName: item.seoName ?? "",
                  name: item.name,
                },
              })
            }
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: index % 2 ? bg : card,
                borderBottomColor: border,
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <TeamLogo seoName={item.seoName} fallback={item.name} size={34} />
            <RNView style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>
                {item.rank ? (
                  <Text style={styles.rank}>{item.rank} </Text>
                ) : null}
                {item.name}
              </Text>
              {item.conference ? (
                <Text style={[styles.conference, { color: muted }]}>
                  {item.conference}
                </Text>
              ) : null}
            </RNView>
            <Text style={styles.record}>
              {item.wins}-{item.losses}
            </Text>
            <Text style={[styles.chevron, { color: muted }]}>›</Text>
          </Pressable>
        )}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} />
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: muted }]}>
            {loading
              ? "Loading teams…"
              : error
                ? `Couldn't load teams (${error})`
                : search
                  ? "No matching teams."
                  : "No teams available."}
          </Text>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: {
    paddingBottom: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    minHeight: 32,
  },
  title: { fontSize: 19, fontWeight: "800" },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 10,
  },
  filterDivider: { width: StyleSheet.hairlineWidth, height: 18 },
  search: {
    marginHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
  },
  list: { paddingBottom: 28 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identity: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: "700" },
  rank: { fontSize: 11, fontWeight: "700", color: "#3779be" },
  conference: { fontSize: 11, marginTop: 1 },
  record: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chevron: { fontSize: 20, marginLeft: 2 },
  empty: { textAlign: "center", marginTop: 40 },
});
