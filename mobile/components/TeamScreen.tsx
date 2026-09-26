import { router, Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View as RNView,
} from "react-native";

import { ClnLogo } from "@/components/ClnLogo";
import { Segmented } from "@/components/Segmented";
import { TeamLogo } from "@/components/TeamLogo";
import { Text, View, useThemeColor } from "@/components/Themed";
import { brand } from "@/constants/Colors";
import { useV1 } from "@/hooks/useV1";
import { fetchTeam } from "@/lib/api";
import type {
  Division,
  Sport,
  V1RosterPlayer,
  V1TeamDetail,
  V1TeamGame,
} from "@/lib/types";

type Tab = "schedule" | "roster";

export interface TeamScreenProps {
  id: string;
  sport: Sport;
  division: Division;
  /** NCAA seoName if known from the game row, for the logo before the team loads */
  seoName?: string;
  name?: string;
  /** route prefix for opponent links, e.g. '/games/team/[id]' or '/teams/[id]' */
  teamPath: "/games/team/[id]" | "/teams/[id]";
}

const rec = (r: { wins: number; losses: number } | null) =>
  r ? `${r.wins}-${r.losses}` : "–";

function gameDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface SideTeam {
  name: string;
  seoName: string | null;
  rank: number | null;
}

function ScheduleSide({
  t,
  right,
  onPress,
}: {
  t: SideTeam;
  right?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={[styles.sSide, right && styles.sSideRight]}
      accessibilityLabel={t.name}
    >
      <Text
        style={[styles.sName, right && { textAlign: "right" }]}
        numberOfLines={1}
      >
        {t.rank ? <Text style={styles.rank}>{t.rank} </Text> : null}
        {t.name}
      </Text>
      <TeamLogo seoName={t.seoName} fallback={t.name} size={32} />
    </Pressable>
  );
}

function ScheduleRow({
  g,
  team,
  alt,
  onOpponent,
}: {
  g: V1TeamGame;
  team: V1TeamDetail;
  alt: boolean;
  onOpponent: (g: V1TeamGame) => void;
}) {
  const muted = useThemeColor({}, "muted");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const border = useThemeColor({}, "border");
  const us: SideTeam = {
    name: team.name,
    seoName: team.seoName,
    rank: team.rank,
  };
  const them: SideTeam = {
    name: g.opponent.name,
    seoName: g.opponent.seoName,
    rank: g.opponent.rank,
  };
  const away = g.home ? them : us;
  const home = g.home ? us : them;
  const awayScore = g.score ? (g.home ? g.score.them : g.score.us) : null;
  const homeScore = g.score ? (g.home ? g.score.us : g.score.them) : null;
  const resultColor =
    g.result === "W" ? brand.win : g.result === "L" ? brand.red : muted;
  const open = g.opponent.id ? () => onOpponent(g) : undefined;
  return (
    <RNView
      style={[
        styles.sRow,
        { backgroundColor: alt ? bg : card, borderBottomColor: border },
      ]}
    >
      <ScheduleSide t={away} onPress={away === them ? open : undefined} />
      <RNView style={styles.sCenter}>
        {g.final && g.score ? (
          <Text style={[styles.sScore, { color: resultColor }]}>
            {g.result ? `${g.result} ` : ""}
            {awayScore} - {homeScore}
          </Text>
        ) : (
          <Text style={[styles.sTime, { color: brand.red }]} numberOfLines={1}>
            {gameDate(g.date)}
            {g.time ? ` - ${g.time}` : ""}
          </Text>
        )}
        <Text style={[styles.sSub, { color: muted }]} numberOfLines={1}>
          {g.final ? gameDate(g.date) : g.home ? "Home" : "Away"}
          {g.playoff ? ` · ${g.playoff}` : ""}
        </Text>
      </RNView>
      <ScheduleSide t={home} right onPress={home === them ? open : undefined} />
    </RNView>
  );
}

function RosterRow({
  p,
  alt,
  isWomen,
}: {
  p: V1RosterPlayer;
  alt: boolean;
  isWomen: boolean;
}) {
  const muted = useThemeColor({}, "muted");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const border = useThemeColor({}, "border");
  const s = p.stats;
  const stat = (label: string, v: string | number) => `${v} ${label}`;
  const line: string[] = [];
  if (p.position === "G" || s.saves > 0) line.push(stat("SV", s.saves));
  else {
    line.push(stat("G", s.goals), stat("A", s.assists));
    if (s.groundBalls) line.push(stat("GB", s.groundBalls));
    if (s.causedTurnovers) line.push(stat("CT", s.causedTurnovers));
    if (!isWomen && s.faceoffsTaken)
      line.push(`FO ${s.faceoffsWon}-${s.faceoffsTaken}`);
  }
  return (
    <RNView
      style={[
        styles.rRow,
        { backgroundColor: alt ? bg : card, borderBottomColor: border },
      ]}
    >
      <Text style={styles.rNum}>{p.number ?? ""}</Text>
      <RNView style={styles.rMeta}>
        <Text style={styles.rPos}>{p.position ?? ""}</Text>
        <Text style={[styles.rYear, { color: muted }]}>{p.year ?? ""}</Text>
      </RNView>
      <RNView style={styles.rMain}>
        <Text style={styles.rName} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={[styles.rTown, { color: muted }]} numberOfLines={1}>
          {p.hometown ?? ""}
        </Text>
      </RNView>
      <Text style={[styles.rStats, { color: muted }]} numberOfLines={2}>
        {line.slice(0, 2).join("\n")}
      </Text>
    </RNView>
  );
}

export function TeamScreen({
  id,
  sport,
  division,
  seoName,
  name,
  teamPath,
}: TeamScreenProps) {
  const [tab, setTab] = useState<Tab>("schedule");
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const card = useThemeColor({}, "card");
  const {
    data: team,
    loading,
    error,
    refresh,
  } = useV1<V1TeamDetail>(
    `team/${sport}/${division}/${id}`,
    useCallback(
      (signal: AbortSignal) =>
        fetchTeam(sport, division, id, undefined, signal),
      [sport, division, id],
    ),
  );

  const schedule = useMemo(() => team?.schedule ?? [], [team]);
  const roster = useMemo(
    () =>
      [...(team?.roster ?? [])].sort(
        (a, b) =>
          (Number(a.number) || 999) - (Number(b.number) || 999) ||
          a.name.localeCompare(b.name),
      ),
    [team],
  );

  const openOpponent = (g: V1TeamGame) => {
    if (!g.opponent.id) return;
    router.push({
      pathname: teamPath,
      params: {
        id: g.opponent.id,
        sport,
        division,
        seoName: g.opponent.seoName ?? "",
        name: g.opponent.name,
      },
    });
  };

  const title = team?.name ?? name ?? "Team";
  const logo = team?.seoName ?? seoName ?? null;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{ title, headerRight: () => <ClnLogo size={26} /> }}
      />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} />
        }
        contentContainerStyle={styles.list}
      >
        <RNView
          style={[
            styles.head,
            { backgroundColor: card, borderBottomColor: border },
          ]}
        >
          <TeamLogo seoName={logo} fallback={title} size={72} />
          <RNView style={styles.records}>
            <Text style={styles.recLine}>
              {team?.conference ?? "Conference"} Record:{" "}
              <Text style={styles.recVal}>
                {rec(team?.conferenceRecord ?? null)}
              </Text>
            </Text>
            <Text style={styles.recLine}>
              Overall Record:{" "}
              <Text style={styles.recVal}>
                {team ? rec(team.overall) : "–"}
              </Text>
            </Text>
            {team?.coach ? (
              <Text style={styles.recLine}>
                Coach: <Text style={styles.recVal}>{team.coach}</Text>
              </Text>
            ) : null}
            {team?.rank ? (
              <Text style={[styles.recLine, { color: muted }]}>
                Ranked #{team.rank}
              </Text>
            ) : null}
          </RNView>
        </RNView>
        <RNView style={styles.tabs}>
          <Segmented<Tab>
            options={[
              { key: "schedule", label: "Schedule" },
              { key: "roster", label: "Roster" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </RNView>

        {!team ? (
          <Text style={[styles.empty, { color: muted }]}>
            {loading
              ? "Loading…"
              : error
                ? `Couldn't load team (${error})`
                : "Team not found."}
          </Text>
        ) : tab === "schedule" ? (
          schedule.length ? (
            schedule.map((g, i) => (
              <ScheduleRow
                key={`${g.date}-${g.opponent.id ?? g.opponent.name}-${i}`}
                g={g}
                team={team}
                alt={i % 2 === 1}
                onOpponent={openOpponent}
              />
            ))
          ) : (
            <Text style={[styles.empty, { color: muted }]}>
              No schedule published for {team.season}.
            </Text>
          )
        ) : roster.length ? (
          roster.map((p, i) => (
            <RosterRow
              key={p.id}
              p={p}
              alt={i % 2 === 1}
              isWomen={sport === "lacrosse-women"}
            />
          ))
        ) : (
          <Text style={[styles.empty, { color: muted }]}>
            No roster published for {team.season}.
          </Text>
        )}
        {team ? (
          <Text style={[styles.source, { color: muted }]}>
            {team.season} season · schedule & roster via Lax.com
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 28 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  records: { flex: 1, gap: 2 },
  recLine: { fontSize: 13, fontWeight: "700" },
  recVal: { fontWeight: "500" },
  tabs: { paddingHorizontal: 10, paddingVertical: 8 },
  empty: { textAlign: "center", marginTop: 32, paddingHorizontal: 24 },
  source: { textAlign: "center", fontSize: 11, marginTop: 14 },

  sRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sSide: { width: 112, alignItems: "flex-start", gap: 4 },
  sSideRight: { alignItems: "flex-end" },
  sName: { fontSize: 16, fontWeight: "800", maxWidth: "100%" },
  rank: { fontSize: 11, fontWeight: "700", color: "#3779be" },
  sCenter: {
    flex: 1,
    alignItems: "center",
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  sTime: { fontSize: 16, fontWeight: "800" },
  sScore: { fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sSub: { fontSize: 10, marginTop: 3 },

  rRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rNum: {
    width: 30,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  rMeta: { width: 26, alignItems: "center" },
  rPos: { fontSize: 13, fontWeight: "700" },
  rYear: { fontSize: 11 },
  rMain: { flex: 1, minWidth: 0 },
  rName: { fontSize: 15, fontWeight: "700" },
  rTown: { fontSize: 11, marginTop: 1 },
  rStats: {
    fontSize: 11,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    minWidth: 44,
  },
});
