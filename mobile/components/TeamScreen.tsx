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

import { Chips } from "@/components/Chips";
import { ClnLogo } from "@/components/ClnLogo";
import { Segmented } from "@/components/Segmented";
import { TeamLogo } from "@/components/TeamLogo";
import { Text, View, useThemeColor } from "@/components/Themed";
import { brand } from "@/constants/Colors";
import { useV1 } from "@/hooks/useV1";
import { fetchGames, fetchTeam } from "@/lib/api";
import { isFavorite, isWatching, setFavorite, toggleWatch, useFollows } from "@/lib/favorites";
import { personName } from "@/lib/names";
import type {
  Division,
  Sport,
  V1RosterPlayer,
  V1TeamDetail,
  V1TeamGame,
} from "@/lib/types";

type Tab = "schedule" | "roster" | "stats";

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
              {personName(p.name)}
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
              <Text style={styles.bioLine}>{p.highSchool ?? ""}</Text>
            </RNView>
            <RNView style={styles.bioCol}>
              <Text style={styles.bioLine}>
                {p.position ? (POSITIONS[p.position] ?? p.position) : ""}
              </Text>
              <Text style={styles.bioLine}>
                {p.year ? (YEARS[p.year] ?? p.year) : ""}
              </Text>
              <Text style={styles.bioLine}>{heightWeight(p)}</Text>
            </RNView>
          </RNView>
          <RNView style={[styles.statsHead, { backgroundColor: border }]}>
            <Text style={styles.statsHeadText}>{team.season} STATISTICS</Text>
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
  onGame,
}: {
  g: V1TeamGame;
  team: V1TeamDetail;
  alt: boolean;
  onOpponent: (g: V1TeamGame) => void;
  onGame: (g: V1TeamGame) => void;
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
      <Pressable
        style={styles.sCenter}
        onPress={() => onGame(g)}
        accessibilityRole="button"
      >
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
      </Pressable>
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
          {personName(p.name)}
        </Text>
        <Text style={[styles.rTown, { color: muted }]} numberOfLines={1}>
          {p.hometown ?? ""}
        </Text>
      </RNView>
      <RNView style={styles.rSize}>
        <Text style={styles.rHt}>{p.height ?? ""}</Text>
        <Text style={[styles.rWt, { color: muted }]}>
          {p.weight != null ? String(p.weight) : ""}
        </Text>
      </RNView>
    </Pressable>
  );
}

function heightWeight(p: V1RosterPlayer): string {
  return [p.height, p.weight != null ? `${p.weight} lbs` : null]
    .filter(Boolean)
    .join(" / ");
}

type Col = {
  key: string;
  label: string;
  value: (p: V1RosterPlayer) => number | string;
  sort: (p: V1RosterPlayer) => number;
  wide?: boolean;
};

const ratio = (n: number, d: number) => (d ? (n / d).toFixed(3).slice(1) : "–");

const FIELD_COLS: Col[] = [
  {
    key: "goals",
    label: "G",
    value: (p) => p.stats.goals,
    sort: (p) => p.stats.goals,
  },
  {
    key: "assists",
    label: "A",
    value: (p) => p.stats.assists,
    sort: (p) => p.stats.assists,
  },
  {
    key: "points",
    label: "PTS",
    value: (p) => p.stats.goals + p.stats.assists,
    sort: (p) => p.stats.goals + p.stats.assists,
  },
  {
    key: "shots",
    label: "SH",
    value: (p) => p.stats.shots,
    sort: (p) => p.stats.shots,
  },
  {
    key: "shPct",
    label: "SH%",
    wide: true,
    value: (p) => ratio(p.stats.goals, p.stats.shots),
    sort: (p) => (p.stats.shots ? p.stats.goals / p.stats.shots : -1),
  },
  {
    key: "groundBalls",
    label: "GB",
    value: (p) => p.stats.groundBalls,
    sort: (p) => p.stats.groundBalls,
  },
  {
    key: "turnovers",
    label: "TO",
    value: (p) => p.stats.turnovers,
    sort: (p) => p.stats.turnovers,
  },
  {
    key: "causedTurnovers",
    label: "CT",
    value: (p) => p.stats.causedTurnovers,
    sort: (p) => p.stats.causedTurnovers,
  },
  {
    key: "faceoffsWon",
    label: "FOW",
    wide: true,
    value: (p) => p.stats.faceoffsWon,
    sort: (p) => p.stats.faceoffsWon,
  },
  {
    key: "faceoffsTaken",
    label: "FOT",
    wide: true,
    value: (p) => p.stats.faceoffsTaken,
    sort: (p) => p.stats.faceoffsTaken,
  },
  {
    key: "foPct",
    label: "FO%",
    wide: true,
    value: (p) => ratio(p.stats.faceoffsWon, p.stats.faceoffsTaken),
    sort: (p) =>
      p.stats.faceoffsTaken ? p.stats.faceoffsWon / p.stats.faceoffsTaken : -1,
  },
];

const GOALIE_COLS: Col[] = [
  {
    key: "saves",
    label: "SV",
    value: (p) => p.stats.saves,
    sort: (p) => p.stats.saves,
  },
  {
    key: "shotsFaced",
    label: "SF",
    value: (p) => p.stats.shotsFaced,
    sort: (p) => p.stats.shotsFaced,
  },
  {
    key: "svPct",
    label: "SV%",
    wide: true,
    value: (p) => ratio(p.stats.saves, p.stats.shotsFaced),
    sort: (p) => (p.stats.shotsFaced ? p.stats.saves / p.stats.shotsFaced : -1),
  },
  {
    key: "goals",
    label: "G",
    value: (p) => p.stats.goals,
    sort: (p) => p.stats.goals,
  },
  {
    key: "assists",
    label: "A",
    value: (p) => p.stats.assists,
    sort: (p) => p.stats.assists,
  },
  {
    key: "groundBalls",
    label: "GB",
    value: (p) => p.stats.groundBalls,
    sort: (p) => p.stats.groundBalls,
  },
  {
    key: "turnovers",
    label: "TO",
    value: (p) => p.stats.turnovers,
    sort: (p) => p.stats.turnovers,
  },
  {
    key: "causedTurnovers",
    label: "CT",
    value: (p) => p.stats.causedTurnovers,
    sort: (p) => p.stats.causedTurnovers,
  },
];

const nameKey = (s: string) =>
  s.toLowerCase().replace(/\b(university|college|of|the)\b/g, "").replace(/[^a-z0-9]/g, "");

const ROW_H = 34;
const NAME_W = 200;

// Player column stays fixed on the left; stat columns scroll horizontally as
// one block so every row stays aligned with its header.
function FrozenGrid({
  title,
  cols,
  rows,
  defaultSort,
  onPlayer,
}: {
  title: string;
  cols: Col[];
  rows: V1RosterPlayer[];
  defaultSort: string;
  onPlayer: (p: V1RosterPlayer) => void;
}) {
  const [sort, setSort] = useState(defaultSort);
  const card = useThemeColor({}, "card");
  const bg = useThemeColor({}, "background");
  const border = useThemeColor({}, "border");
  const active = cols.find((c) => c.key === sort) ?? cols[0];
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          active.sort(b) - active.sort(a) ||
          b.stats.goals + b.stats.assists - (a.stats.goals + a.stats.assists) ||
          a.name.localeCompare(b.name),
      ),
    [rows, active],
  );
  const rowBg = (i: number) => ({
    backgroundColor: i % 2 ? bg : card,
    borderBottomColor: border,
  });
  return (
    <RNView style={styles.grid}>
      <RNView style={[styles.gridFrozen, { borderRightColor: border }]}>
        <RNView style={[styles.gRow, styles.tHead]}>
          <Text style={[styles.tHeadText, styles.gName]}>{title}</Text>
        </RNView>
        {sorted.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => onPlayer(p)}
            style={[styles.gRow, rowBg(i)]}
          >
            <Text style={styles.gName} numberOfLines={1}>
              <Text style={styles.tNum}>{p.number ?? ""} </Text>
              {personName(p.name)}
            </Text>
          </Pressable>
        ))}
      </RNView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
      >
        <RNView>
          <RNView style={[styles.gRow, styles.tHead]}>
            {cols.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => setSort(c.key)}
                style={[
                  styles.gCell,
                  c.wide && styles.gCellWide,
                  sort === c.key && styles.tCellActive,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.tHeadText}>{c.label}</Text>
              </Pressable>
            ))}
          </RNView>
          {sorted.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => onPlayer(p)}
              style={[styles.gRow, rowBg(i)]}
            >
              {cols.map((c) => (
                <Text
                  key={c.key}
                  style={[
                    styles.gCell,
                    c.wide && styles.gCellWide,
                    styles.tVal,
                    { borderLeftColor: border },
                  ]}
                >
                  {c.value(p)}
                </Text>
              ))}
            </Pressable>
          ))}
        </RNView>
      </ScrollView>
    </RNView>
  );
}

function StatsTable({
  roster,
  onPlayer,
}: {
  roster: V1RosterPlayer[];
  onPlayer: (p: V1RosterPlayer) => void;
}) {
  const field = roster.filter((p) => p.position !== "G");
  const goalies = roster.filter((p) => p.position === "G");
  return (
    <RNView>
      <FrozenGrid
        title="PLAYER"
        cols={FIELD_COLS}
        rows={field}
        defaultSort="points"
        onPlayer={onPlayer}
      />
      {goalies.length ? (
        <FrozenGrid
          title="GOALIE"
          cols={GOALIE_COLS}
          rows={goalies}
          defaultSort="saves"
          onPlayer={onPlayer}
        />
      ) : null}
      <Text style={styles.swipeHint}>swipe stats for more →</Text>
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
  const [season, setSeason] = useState<string | undefined>();
  const [seasons, setSeasons] = useState<string[]>([]);
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const card = useThemeColor({}, "card");
  const {
    data: team,
    loading,
    error,
    refresh,
  } = useV1<V1TeamDetail>(
    `team/${sport}/${division}/${id}/${season ?? ""}`,
    useCallback(
      async (signal: AbortSignal) => {
        const res = await fetchTeam(sport, division, id, season, signal);
        const list = res.data?.seasons ?? [];
        if (list.length)
          setSeasons((prev) =>
            [...new Set([...prev, ...list])].sort((a, b) => b.localeCompare(a)),
          );
        return res;
      },
      [sport, division, id, season],
    ),
  );
  const current = season ?? team?.season ?? seasons[0];

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

  const openGame = async (g: V1TeamGame) => {
    if (!team) return;
    try {
      const { data } = await fetchGames(sport, division, g.date);
      const sides = [team.seoName, g.opponent.seoName];
      const names = [team.name, g.opponent.name].map(nameKey);
      const match = data.find((game) => {
        const seo = [game.home.seoName, game.away.seoName];
        const nm = [game.home.name, game.away.name, game.home.shortName, game.away.shortName].map(nameKey);
        return (
          sides.every((s) => s && seo.includes(s)) ||
          names.every((n) => nm.includes(n))
        );
      });
      if (match) router.push({ pathname: "/games/[id]", params: { id: match.id } });
    } catch {
      // no NCAA game to open for this date
    }
  };

  const title = team?.name ?? name ?? "Team";
  const logo = team?.seoName ?? seoName ?? null;
  const follows = useFollows();
  const me = { id, name: title, seoName: logo, sport, division };
  const fav = isFavorite(follows, me);
  const watching = isWatching(follows, me);

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
                Coach: <Text style={styles.recVal}>{personName(team.coach)}</Text>
              </Text>
            ) : null}
            {team?.rank ? (
              <Text style={[styles.recLine, { color: muted }]}>
                Ranked #{team.rank}
              </Text>
            ) : null}
            <RNView style={styles.follow}>
              <Pressable
                onPress={() => setFavorite(fav ? null : me)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ selected: fav }}
                style={[styles.followBtn, fav && styles.followOn]}
              >
                <Text style={[styles.followText, fav && styles.followTextOn]}>
                  {fav ? "★ Favorite" : "☆ Make favorite"}
                </Text>
              </Pressable>
              {!fav ? (
                <Pressable
                  onPress={() => toggleWatch(me)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ selected: watching }}
                  style={[styles.followBtn, watching && styles.followOn]}
                >
                  <Text style={[styles.followText, watching && styles.followTextOn]}>
                    {watching ? "✓ Watching" : "+ Watch"}
                  </Text>
                </Pressable>
              ) : null}
            </RNView>
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
        {seasons.length > 1 && current ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.seasons}
          >
            <Chips
              options={seasons.map((s) => ({ key: s, label: s }))}
              value={current}
              onChange={setSeason}
            />
          </ScrollView>
        ) : null}

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
                onGame={openGame}
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
          <>
            {team.rosterSeason && team.rosterSeason !== team.season ? (
              <Text style={[styles.rosterNote, { color: muted }]}>
                {team.rosterSeason} roster
              </Text>
            ) : null}
            {roster.map((p, i) => (
              <RosterRow
                key={p.id}
                p={p}
                alt={i % 2 === 1}
                onPress={() => setPlayer(p)}
              />
            ))}
          </>
        ) : (
          <StatsTable roster={roster} onPlayer={setPlayer} />
        )}
      </ScrollView>
      {team ? (
        <PlayerSheet p={player} team={team} onClose={() => setPlayer(null)} />
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
  follow: { flexDirection: "row", gap: 6, marginTop: 4 },
  followBtn: {
    borderWidth: 1,
    borderColor: brand.navy,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  followOn: { backgroundColor: brand.navy },
  followText: { fontSize: 12, fontWeight: "700", color: brand.navy },
  followTextOn: { color: "#fff" },
  recLine: { fontSize: 14, fontWeight: "700" },
  recVal: { fontWeight: "500" },
  tabs: { paddingHorizontal: 10, paddingVertical: 8 },
  empty: { textAlign: "center", marginTop: 32, paddingHorizontal: 24 },

  sRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sSide: { width: 136, alignItems: "flex-start", gap: 6 },
  sSideRight: { alignItems: "flex-end" },
  sName: { fontSize: 14, fontWeight: "700", maxWidth: "100%" },
  rank: { fontSize: 11, fontWeight: "700", color: "#3779be" },
  sCenter: {
    flex: 1,
    alignItems: "center",
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  sTime: { fontSize: 14, fontWeight: "700" },
  sScore: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
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
  seasons: { paddingHorizontal: 8, paddingBottom: 6 },
  rMain: { flex: 1, minWidth: 0 },
  rName: { fontSize: 15, fontWeight: "700" },
  rTown: { fontSize: 11, marginTop: 1 },
  rosterNote: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 10,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  rSize: { width: 40, alignItems: "flex-end" },
  rHt: { fontSize: 12, fontWeight: "600" },
  rWt: { fontSize: 11 },

  grid: { flexDirection: "row" },
  gridFrozen: { width: NAME_W, borderRightWidth: StyleSheet.hairlineWidth },
  gRow: {
    flexDirection: "row",
    alignItems: "center",
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gName: {
    width: NAME_W,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 8,
    textAlign: "left",
  },
  gCell: { width: 44, height: ROW_H, justifyContent: "center" },
  gCellWide: { width: 54 },
  swipeHint: {
    textAlign: "center",
    fontSize: 11,
    marginTop: 10,
    color: "#8e8e93",
  },
  tHead: { backgroundColor: "#3a3a3c" },
  tHeadText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
  },
  tNum: { fontWeight: "800" },
  tCellActive: { backgroundColor: "#3779be" },
  tVal: {
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    color: "#14365c",
    lineHeight: ROW_H,
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
