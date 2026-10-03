import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View as RNView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chips } from "@/components/Chips";
import { ClnLogo } from "@/components/ClnLogo";
import { ConferenceBand } from "@/components/ConferenceBand";
import { TeamLogo } from "@/components/TeamLogo";
import { Text, View, useThemeColor } from "@/components/Themed";
import { useV1 } from "@/hooks/useV1";
import { DIVISIONS, fetchTeams, SPORTS } from "@/lib/api";
import { conferenceName } from "@/lib/conferences";
import { followedOn, teamKey, useFollows } from "@/lib/favorites";
import type { Division, Sport, V1TeamSummary } from "@/lib/types";

const INDEPENDENT = "Independent";

function groupByConference(teams: V1TeamSummary[], mine: Set<string>) {
  const map = new Map<string, V1TeamSummary[]>();
  const myTeams = teams.filter((t) => mine.has(teamKey(t)));
  if (myTeams.length) map.set("My Teams", myTeams);
  for (const t of teams) {
    const key = t.conference ? conferenceName(t.conference) : INDEPENDENT;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()]
    .sort(([a], [b]) =>
      a === "My Teams"
        ? -1
        : b === "My Teams"
          ? 1
          : a === INDEPENDENT
            ? 1
            : b === INDEPENDENT
              ? -1
              : a.localeCompare(b),
    )
    .map(([title, data]) => ({
      title,
      data: data.sort((x, y) => x.name.localeCompare(y.name)),
    }));
}

export default function TeamsScreen() {
  const follows = useFollows();
  const [sport, setSport] = useState<Sport>(
    follows.favorite?.sport ?? "lacrosse-men",
  );
  const [division, setDivision] = useState<Division>(
    follows.favorite?.division ?? "d1",
  );
  const card = useThemeColor({}, "card");
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const bg = useThemeColor({}, "background");
  const insets = useSafeAreaInsets();

  const { data, error, loading, refresh } = useV1<V1TeamSummary[]>(
    `teams/${sport}/${division}`,
    useCallback(
      (signal: AbortSignal) => fetchTeams(sport, division, signal),
      [sport, division],
    ),
  );

  const mine = useMemo(
    () => new Set(followedOn(follows, sport, division).map(teamKey)),
    [follows, sport, division],
  );
  const sections = useMemo(
    () => groupByConference(data ?? [], mine),
    [data, mine],
  );

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
          <Text style={styles.title}>
            Teams - {sport === "lacrosse-men" ? "Men" : "Women"}
          </Text>
          <RNView style={{ width: 26 }} />
        </RNView>
        <RNView style={styles.filters}>
          <Chips options={SPORTS} value={sport} onChange={setSport} />
          <RNView style={[styles.filterDivider, { backgroundColor: border }]} />
          <Chips options={DIVISIONS} value={division} onChange={setDivision} />
        </RNView>
      </RNView>
      <SectionList
        sections={sections}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <ConferenceBand title={section.title} />
        )}
        renderItem={({ item, index, section }) => (
          <Pressable
            key={`${section.title}-${item.id}`}
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
            <TeamLogo seoName={item.seoName} fallback={item.name} size={40} />
            <Text style={styles.name} numberOfLines={1}>
              {item.rank ? <Text style={styles.rank}>{item.rank} </Text> : null}
              {item.name}
            </Text>
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
    paddingBottom: 6,
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
  list: { paddingBottom: 28 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 16, fontWeight: "600" },
  rank: { fontSize: 12, fontWeight: "700", color: "#3779be" },
  empty: { textAlign: "center", marginTop: 40 },
});
