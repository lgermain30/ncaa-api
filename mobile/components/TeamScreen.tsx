import { router, Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Modal,
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

type Tab = "schedule" | "roster" | "stats";
type StatKey = "goals" | "assists" | "points" | "groundBalls";

const POSITIONS: Record<string, string> = {
  A: "Attack",
  M: "Midfield",
  D: "Defense",
  G: "Goalie",
  FO: "Faceoff",
  LSM: "Long-stick Midfield",
  SSDM: "Short-stick Defensive Midfield",
  DM: "Defensive Midfield",
};
const YEARS: Record<string, string> = {
  Fr: "Freshman",
  So: "Sophomore",
  Jr: "Junior",
  Sr: "Senior",
  Gr: "Graduate",
};

const pct = (n: number, d: number) =>
  d ? `${((n / d) * 100).toFixed(1)}%` : "–";

function playerStatRows(p: V1RosterPlayer) {
  const s = p.stats;
  const goalie = p.position === "G" || s.shotsFaced > 0;
  const rows: [string, string | number][] = [];
  if (goalie) {
    rows.push(["Saves", s.saves], ["Shots Faced", s.shotsFaced]);
    rows.push(["Save Percentage", pct(s.saves, s.shotsFaced)]);
  }
  rows.push(
    ["Goals", s.goals],
    ["Assists", s.assists],
    ["Points", s.goals + s.assists],
    ["Shots", s.shots],
    ["Shooting Percentage", pct(s.goals, s.shots)],
    ["Ground Balls", s.groundBalls],
    ["Turnovers", s.turnovers],
    ["Caused Turnovers", s.causedTurnovers],
  );
  if (s.faceoffsTaken) {
    rows.push(["Faceoffs (W-T)", `${s.faceoffsWon}-${s.faceoffsTaken}`]);
    rows.push(["Faceoff Percentage", pct(s.faceoffsWon, s.faceoffsTaken)]);
  }
  return rows;
}

function PlayerSheet({
  p,
  team,
  onClose,
}: {
  p: V1RosterPlayer | null;
  team: V1TeamDetail;
  onClose: () => void;
}) {
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const rows = p ? playerStatRows(p) : [];
  return (
    <Modal
      visible={!!p}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {p ? (
        <View style={styles.sheet}>
          <RNView style={styles.sheetHead}>
            <Text style={styles.sheetName} numberOfLines={1}>
              {p.number ? `${p.number} ` : ""}
              {p.name}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.sheetClose, { color: muted }]}>✕</Text>
            </Pressable>
          </RNView>
          <RNView style={styles.bio}>
            <RNView style={styles.bioWatermark} pointerEvents="none">
              <TeamLogo
                seoName={team.seoName}
                fallback={team.name}
                size={140}
              />
            </RNView>
            <RNView style={styles.bioCol}>
              <Text style={styles.bioLine}>{team.name}</Text>
              <Text style={styles.bioLine}>{p.hometown ?? ""}</Text>
            </RNView>
            <RNView style={styles.bioCol}>
              <Text style={styles.bioLine}>
                {p.position ? (POSITIONS[p.position] ?? p.position) : ""}
              </Text>
              <Text style={styles.bioLine}>
                {p.year ? (YEARS[p.year] ?? p.year) : ""}
              </Text>
            </RNView>
          </RNView>
          <RNView style={[styles.statsHead, { backgroundColor: border }]}>
            <Text style={styles.statsHeadText}>
              {team.season} STATISTICS
            </Text>
          </RNView>
          <ScrollView>
            {rows.map(([label, v], i) => (
              <RNView
                key={label}
                style={[
                  styles.statRow,
                  {
                    backgroundColor: i % 2 ? bg : card,
                    borderBottomColor: border,
                  },
                ]}
              >
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statVal}>{v}</Text>
              </RNView>
            ))}
            <Text style={[styles.source, { color: muted }]}>
              Season totals via Lax.com
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

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
    year: "numeric",
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
        {right && t.rank ? <Text style={styles.rank}>{t.rank} </Text> : null}
        {t.name}
        {!right && t.rank ? <Text style={styles.rank}> {t.rank}</Text> : null}
      </Text>
      <TeamLogo seoName={t.seoName} fallback={t.name} size={40} />
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
          <Text style={[styles.sTime, { color: "#d9531e" }]} numberOfLines={1}>
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
  onPress,
}: {
  p: V1RosterPlayer;
  alt: boolean;
  onPress: () => void;
}) {
  const muted = useThemeColor({}, "muted");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const border = useThemeColor({}, "border");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[
        styles.rRow,
        { backgroundColor: alt ? bg : card, borderBottomColor: border },
      ]}
    >
      <Text style={styles.rNum} numberOfLines={1}>
        {p.number ?? ""}
      </Text>
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
    </Pressable>
  );
}

const STAT_COLS: { key: StatKey; label: string }[] = [
  { key: "goals", label: "G" },
  { key: "assists", label: "A" },
  { key: "points", label: "PTS" },
  { key: "groundBalls", label: "GB" },
];

const statOf = (p: V1RosterPlayer, k: StatKey) =>
  k === "points" ? p.stats.goals + p.stats.assists : p.stats[k];

function StatsTable({
  roster,
  onPlayer,
}: {
  roster: V1RosterPlayer[];
  onPlayer: (p: V1RosterPlayer) => void;
}) {
  const [sort, setSort] = useState<StatKey>("goals");
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const border = useThemeColor({}, "border");
  const skaters = useMemo(
    () =>
      roster
        .filter((p) => p.position !== "G")
        .sort(
          (a, b) =>
            statOf(b, sort) - statOf(a, sort) ||
            statOf(b, "points") - statOf(a, "points") ||
            a.name.localeCompare(b.name),
        ),
    [roster, sort],
  );
  const goalies = useMemo(
    () =>
      roster
        .filter((p) => p.position === "G")
        .sort((a, b) => b.stats.saves - a.stats.saves),
    [roster],
  );
  return (
    <RNView>
      <RNView style={[styles.tRow, styles.tHead]}>
        <Text style={[styles.tPlayer, styles.tHeadText]}>PLAYER</Text>
        {STAT_COLS.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setSort(c.key)}
            style={[styles.tCell, sort === c.key && styles.tCellActive]}
            accessibilityRole="button"
          >
            <Text style={styles.tHeadText}>{c.label}</Text>
          </Pressable>
        ))}
      </RNView>
      {skaters.map((p, i) => (
        <Pressable
          key={p.id}
          onPress={() => onPlayer(p)}
          style={[
            styles.tRow,
            { backgroundColor: i % 2 ? bg : card, borderBottomColor: border },
          ]}
        >
          <Text style={styles.tPlayer} numberOfLines={1}>
            <Text style={styles.tNum}>{p.number ?? ""} </Text>
            {p.name}
          </Text>
          {STAT_COLS.map((c) => (
            <Text
              key={c.key}
              style={[
                styles.tCell,
                styles.tVal,
                { borderLeftColor: border },
              ]}
            >
              {statOf(p, c.key)}
            </Text>
          ))}
        </Pressable>
      ))}
      {goalies.length ? (
        <>
          <RNView style={[styles.tRow, styles.tHead]}>
            <Text style={[styles.tPlayer, styles.tHeadText]}>GOALIE</Text>
            {["SV", "SF", "SV%"].map((l) => (
              <Text key={l} style={[styles.tCell, styles.tHeadText]}>
                {l}
              </Text>
            ))}
          </RNView>
          {goalies.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => onPlayer(p)}
              style={[
                styles.tRow,
                {
                  backgroundColor: i % 2 ? bg : card,
                  borderBottomColor: border,
                },
              ]}
            >
              <Text style={styles.tPlayer} numberOfLines={1}>
                <Text style={styles.tNum}>{p.number ?? ""} </Text>
                {p.name}
              </Text>
              {[
                p.stats.saves,
                p.stats.shotsFaced,
                p.stats.shotsFaced
                  ? (p.stats.saves / p.stats.shotsFaced).toFixed(3).slice(1)
                  : "–",
              ].map((v, j) => (
                <Text
                  key={j}
                  style={[
                    styles.tCell,
                    styles.tVal,
                    { borderLeftColor: border },
                  ]}
                >
                  {v}
                </Text>
              ))}
            </Pressable>
          ))}
        </>
      ) : null}
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
  const [player, setPlayer] = useState<V1RosterPlayer | null>(null);
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
              { key: "stats", label: "Stats" },
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
        ) : !roster.length ? (
          <Text style={[styles.empty, { color: muted }]}>
            No roster published for {team.season}.
          </Text>
        ) : tab === "roster" ? (
          roster.map((p, i) => (
            <RosterRow
              key={p.id}
              p={p}
              alt={i % 2 === 1}
              onPress={() => setPlayer(p)}
            />
          ))
        ) : (
          <StatsTable roster={roster} onPlayer={setPlayer} />
        )}
        {team ? (
          <Text style={[styles.source, { color: muted }]}>
            {team.season} season · schedule & roster via Lax.com
          </Text>
        ) : null}
      </ScrollView>
      {team ? (
        <PlayerSheet
          p={player}
          team={team}
          onClose={() => setPlayer(null)}
        />
      ) : null}
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
  recLine: { fontSize: 14, fontWeight: "700" },
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
  sSide: { width: 118, alignItems: "flex-start", gap: 6 },
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
    width: 34,
    fontSize: 20,
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

  tRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tHead: { backgroundColor: "#3a3a3c" },
  tHeadText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 6,
  },
  tPlayer: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tNum: { fontWeight: "800" },
  tCell: { width: 48, justifyContent: "center" },
  tCellActive: { backgroundColor: "#3779be" },
  tVal: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "700",
    color: "#14365c",
    paddingVertical: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    fontVariant: ["tabular-nums"],
  },

  sheet: { flex: 1 },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sheetName: { fontSize: 22, fontWeight: "800", flex: 1, marginRight: 12 },
  sheetClose: { fontSize: 22, fontWeight: "800" },
  bio: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingBottom: 16,
    minHeight: 120,
    overflow: "hidden",
  },
  bioWatermark: {
    position: "absolute",
    right: -10,
    top: -6,
    opacity: 0.22,
  },
  bioCol: { flex: 1, gap: 10, paddingTop: 4 },
  bioLine: { fontSize: 16 },
  statsHead: { paddingVertical: 8, alignItems: "center" },
  statsHeadText: { fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statLabel: { fontSize: 16 },
  statVal: {
    fontSize: 16,
    fontWeight: "700",
    color: "#14365c",
    fontVariant: ["tabular-nums"],
  },
});
