import type { ReactNode } from "react";
import { StyleSheet, View as RNView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chips } from "@/components/Chips";
import { ClnLogo } from "@/components/ClnLogo";
import { Text, useThemeColor } from "@/components/Themed";
import { DIVISIONS, SPORTS } from "@/lib/api";
import type { Division, Sport } from "@/lib/types";

/** Compact one-line title + Men's/Women's · DI/DII/DIII pills (Teams-tab style). */
export function BoardHeader({
  title,
  sport,
  division,
  onSport,
  onDivision,
  extra,
}: {
  title: string;
  sport: Sport;
  division: Division;
  onSport: (s: Sport) => void;
  onDivision: (d: Division) => void;
  /** Rendered at the right of the title row (e.g. Players/Teams pills). */
  extra?: ReactNode;
}) {
  const card = useThemeColor({}, "card");
  const border = useThemeColor({}, "border");
  const insets = useSafeAreaInsets();
  return (
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
          {title} - {sport === "lacrosse-men" ? "Men" : "Women"}
        </Text>
        {extra ?? <RNView style={{ width: 26 }} />}
      </RNView>
      <RNView style={styles.filters}>
        <Chips options={SPORTS} value={sport} onChange={onSport} />
        <RNView style={[styles.filterDivider, { backgroundColor: border }]} />
        <Chips options={DIVISIONS} value={division} onChange={onDivision} />
      </RNView>
    </RNView>
  );
}

const styles = StyleSheet.create({
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
});
