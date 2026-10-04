import { router } from "expo-router";
import { Pressable, StyleSheet, View as RNView } from "react-native";

import { TeamLogo } from "@/components/TeamLogo";
import { Text, useThemeColor } from "@/components/Themed";
import { brand } from "@/constants/Colors";
import type { Highlight } from "@/lib/favorites";
import type { V1Game, V1Team } from "@/lib/types";

const HIGHLIGHT_BG: Record<"favorite" | "watching", [string, string]> = {
  favorite: ["#fff7d6", "#ffe9a3"],
  watching: ["#e8f1fb", "#cfe1f7"],
};

const LOGO = 34;

/** Team name + rank on top, logo beneath, hugging the outer edge (CHN layout). */
function Side({
  team,
  home,
  bold,
}: {
  team: V1Team;
  home: boolean;
  bold?: boolean;
}) {
  const name = team.shortName || team.name;
  return (
    <RNView
      accessibilityLabel={`${name}${team.record ? `, ${team.record}` : ""}`}
      style={[
        styles.side,
        home && styles.sideHome,
      ]}
    >
      <RNView style={[styles.nameLine, home && styles.nameLineHome]}>
        {home && team.rank ? (
          <Text style={styles.rank}>{team.rank} </Text>
        ) : null}
        <Text style={[styles.name, home && styles.nameHome, bold && styles.nameBold]} numberOfLines={1}>
          {name}
        </Text>
        {!home && team.rank ? (
          <Text style={styles.rank}> {team.rank}</Text>
        ) : null}
      </RNView>
      <TeamLogo
        seoName={team.seoName}
        fallback={team.char6 || name}
        size={LOGO}
      />
    </RNView>
  );
}

export function GameRow({
  game,
  last,
  alt,
  highlight,
  bold,
}: {
  game: V1Game;
  last?: boolean;
  alt?: boolean;
  /** Which followed team (if any) plays in this game: [away, home]. */
  highlight?: [Highlight, Highlight];
  bold?: boolean;
}) {
  const [a, h] = highlight ?? [null, null];
  const hl = a === "favorite" || h === "favorite" ? "favorite" : (a ?? h);
  const hlBg = hl ? HIGHLIGHT_BG[hl][bold ? 1 : 0] : null;
  const border = useThemeColor({}, "border");
  const muted = useThemeColor({}, "muted");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const { state } = game.status;
  const live = state === "live";
  const final = state === "final";
  const showScore = live || final;
  const venue = game.venue
    ? [
        game.venue.name,
        [game.venue.city, game.venue.state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" - ")
    : "";
  const sub = [venue, game.broadcast.network].filter(Boolean).join(" · ");
  const centerColor = live
    ? brand.live
    : state === "pre" || final
      ? brand.red
      : muted;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/games/[id]",
          params: { id: game.id, tab: state === "pre" ? "rosters" : "goals" },
        })
      }
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: hlBg ?? (alt ? bg : card), borderBottomColor: border },
        last && { borderBottomWidth: 0 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Side team={game.away} home={false} bold={bold && !!highlight?.[0]} />
      <RNView style={styles.center}>
        {showScore ? (
          <RNView style={styles.scoreLine}>
            <Text
              style={[styles.score, live && { color: centerColor }]}
            >
              {game.away.score ?? 0}
            </Text>
            <Text
              style={[styles.status, { color: centerColor }]}
              numberOfLines={1}
            >
              {live ? game.status.display : "FINAL"}
            </Text>
            <Text
              style={[styles.score, live && { color: centerColor }]}
            >
              {game.home.score ?? 0}
            </Text>
          </RNView>
        ) : (
          <Text style={[styles.time, { color: centerColor }]} numberOfLines={1}>
            {state === "pre" ? game.startTime || "TBA" : game.status.display}
          </Text>
        )}
        {sub ? (
          <Text style={[styles.sub, { color: muted }]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </RNView>
      <Side team={game.home} home bold={bold && !!highlight?.[1]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 4 },
  sideHome: { alignItems: "flex-end" },
  nameLine: { flexDirection: "row", alignItems: "baseline", maxWidth: "100%" },
  nameLineHome: { justifyContent: "flex-end" },
  name: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  nameHome: { textAlign: "right" },
  nameBold: { fontWeight: "800", color: brand.navy },
  rank: { fontSize: 11, fontWeight: "600", color: "#3779be" },
  center: {
    width: 150,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  time: { fontSize: 15, fontWeight: "600" },
  scoreLine: { flexDirection: "row", alignItems: "center", gap: 14 },
  score: { fontSize: 20, fontWeight: "500", fontVariant: ["tabular-nums"] },
  status: { fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  sub: { fontSize: 10, textAlign: "center", marginTop: 3 },
});
