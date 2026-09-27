import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View as RNView,
} from "react-native";

import { Segmented } from "@/components/Segmented";
import { TeamLogo } from "@/components/TeamLogo";
import { Text, View, useThemeColor } from "@/components/Themed";
import { brand } from "@/constants/Colors";
import { useGameStream } from "@/hooks/useGameStream";
import { useV1 } from "@/hooks/useV1";
import { fetchBoxscore, fetchGame, fetchPlays, fetchTeam } from "@/lib/api";
import type {
  GameEvent,
  V1Boxscore,
  V1Game,
  V1PlayerLine,
  V1Plays,
  V1Team,
  V1TeamDetail,
  V1TeamLine,
} from "@/lib/types";

type Tab = "rosters" | "goals" | "box" | "plays" | "info";

/** NCAA publishes roster names in ALL CAPS; present them in title case. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(
      /(^|[\s'-])([a-z])/g,
      (_, sep: string, ch: string) => sep + ch.toUpperCase(),
    )
    .replace(/\bMc([a-z])/g, (_, ch: string) => `Mc${ch.toUpperCase()}`);
}

/** "Last, First" -> "First Last" (NCAA play-by-play names are often in that order). */
function firstLast(s: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(s.trim());
  return m ? `${m[2]} ${m[1]}` : s;
}

function n(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : String(v);
}

function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const card = useThemeColor({}, "card");
  const border = useThemeColor({}, "border");
  const muted = useThemeColor({}, "muted");
  return (
    <RNView
      style={[styles.card, { backgroundColor: card, borderColor: border }]}
    >
      {title ? (
        <Text style={[styles.cardTitle, { color: muted }]}>{title}</Text>
      ) : null}
      {children}
    </RNView>
  );
}

function openTeam(game: V1Game, t: V1Team) {
  const name = t.shortName || t.name;
  router.push({
    pathname: "/games/team/[id]",
    params: {
      id: t.seoName || name,
      sport: game.sport,
      division: game.division,
      seoName: t.seoName ?? "",
      name,
    },
  });
}

function HeaderTeam({
  t,
  game,
  final,
}: {
  t: V1Team;
  game: V1Game;
  final: boolean;
}) {
  const muted = useThemeColor({}, "muted");
  const pre = game.status.state === "pre";
  return (
    <Pressable
      onPress={() => openTeam(game, t)}
      style={({ pressed }) => [styles.team, pressed && { opacity: 0.5 }]}
      accessibilityRole="link"
      accessibilityLabel={`${t.name} team page`}
    >
      <Text style={styles.rank}>{t.rank ? String(t.rank) : " "}</Text>
      <Text
        style={[styles.teamName, final && !t.isWinner && { color: muted }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {t.shortName || t.name}
      </Text>
      {pre ? (
        <Text style={[styles.record, { color: muted }]}>{t.record ?? ""}</Text>
      ) : (
        <Text
          style={[styles.bigScore, final && !t.isWinner && { color: muted }]}
        >
          {n(t.score)}
        </Text>
      )}
    </Pressable>
  );
}

/** CHN-style score header: names + scores, red status line (clock/period, FINAL or start time), venue. */
function Header({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const card = useThemeColor({}, "card");
  const border = useThemeColor({}, "border");
  const live = game.status.state === "live";
  const final = game.status.state === "final";
  const pre = game.status.state === "pre";
  const venue = game.venue
    ? [
        game.venue.name,
        [game.venue.city, game.venue.state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" - ")
    : "";
  const statusLine = pre
    ? game.startTime || "TBA"
    : live
      ? [game.status.clock, game.status.period].filter(Boolean).join(" ") ||
        game.status.display
      : game.status.display;
  return (
    <RNView
      style={[
        styles.header,
        { backgroundColor: card, borderBottomColor: border },
      ]}
    >
      <RNView pointerEvents="none" style={[styles.watermark, { left: -10 }]}>
        <TeamLogo
          seoName={game.away.seoName}
          fallback={game.away.char6 || game.away.shortName}
          size={150}
        />
      </RNView>
      <RNView pointerEvents="none" style={[styles.watermark, { right: -10 }]}>
        <TeamLogo
          seoName={game.home.seoName}
          fallback={game.home.char6 || game.home.shortName}
          size={150}
        />
      </RNView>
      <RNView style={styles.scoreRow}>
        <HeaderTeam t={game.away} game={game} final={final} />
        <RNView style={styles.scoreMid}>
          <Text
            style={[styles.status, { color: live ? brand.live : brand.red }]}
            numberOfLines={1}
          >
            {live ? "● " : ""}
            {statusLine}
          </Text>
        </RNView>
        <HeaderTeam t={game.home} game={game} final={final} />
      </RNView>
      {venue || game.broadcast.network ? (
        <Text style={[styles.venue, { color: muted }]} numberOfLines={1}>
          {[venue, game.broadcast.network].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </RNView>
  );
}

function Linescore({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const periods = game.linescore;
  const total = (side: "home" | "away") =>
    periods.every((p) => p[side] === null)
      ? game[side].score
      : periods.reduce((s, p) => s + (p[side] ?? 0), 0);
  return (
    <Card title="Scoring by quarter">
      <RNView>
        <RNView style={styles.lsRow}>
          <Text style={[styles.lsTeam, { color: muted }]} />
          {periods.map((p) => (
            <Text key={p.period} style={[styles.lsCell, { color: muted }]}>
              {p.period}
            </Text>
          ))}
          <Text style={[styles.lsCell, styles.lsTotal, { color: muted }]}>
            T
          </Text>
        </RNView>
        {(["away", "home"] as const).map((side) => (
          <RNView key={side} style={styles.lsRow}>
            <Text style={styles.lsTeam} numberOfLines={1}>
              {game[side].char6 || game[side].shortName}
            </Text>
            {periods.map((p) => (
              <Text key={p.period} style={styles.lsCell}>
                {n(p[side])}
              </Text>
            ))}
            <Text style={[styles.lsCell, styles.lsTotal]}>
              {n(total(side))}
            </Text>
          </RNView>
        ))}
        {game.linescoreSource === "pbp" ? (
          <Text style={[styles.note, { color: muted }]}>
            Quarter scoring rebuilt from play-by-play
          </Text>
        ) : null}
      </RNView>
    </Card>
  );
}

const TEAM_STATS: { label: string; get: (t: V1TeamLine) => string }[] = [
  { label: "Shots", get: (t) => n(t.shots) },
  { label: "Shots on goal", get: (t) => n(t.shotsOnGoal) },
  { label: "Saves", get: (t) => n(t.saves) },
  { label: "Ground balls", get: (t) => n(t.groundBalls) },
  {
    label: "Faceoffs",
    get: (t) =>
      t.faceoffsWon === null
        ? "–"
        : `${t.faceoffsWon}-${t.faceoffsWon + (t.faceoffsLost ?? 0)}`,
  },
  { label: "Draw controls", get: (t) => n(t.drawControls) },
  {
    label: "Clears",
    get: (t) => (t.clears === null ? "–" : `${t.clears}/${n(t.clearAttempts)}`),
  },
  { label: "Turnovers", get: (t) => n(t.turnovers) },
  { label: "Caused TO", get: (t) => n(t.causedTurnovers) },
  {
    label: "EMO",
    get: (t) =>
      t.extraMan ? `${t.extraMan.goals}/${t.extraMan.opportunities}` : "–",
  },
  {
    label: "Penalties",
    get: (t) =>
      t.penalties ? `${t.penalties.count}/${t.penalties.minutes}m` : "–",
  },
];

function Boxscore({ box, game }: { box: V1Boxscore; game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const away = box.teams.find((t) => !t.isHome);
  const home = box.teams.find((t) => t.isHome);
  const stat = (teamId: string | undefined) =>
    box.teamStats.find((t) => t.teamId === teamId);
  const a = stat(away?.teamId);
  const h = stat(home?.teamId);
  const isWomen = game.sport === "lacrosse-women";
  const rows = TEAM_STATS.filter((r) =>
    isWomen ? r.label !== "Faceoffs" : r.label !== "Draw controls",
  );

  return (
    <>
      <Card title="Team stats">
        <RNView
          style={[
            styles.lsRow,
            {
              borderBottomColor: border,
              borderBottomWidth: StyleSheet.hairlineWidth,
              paddingBottom: 4,
            },
          ]}
        >
          <Text
            style={[styles.statVal, styles.statTeam, { color: muted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {game.away.char6 || away?.shortName}
          </Text>
          <Text style={[styles.statLabel, { color: muted }]} />
          <Text
            style={[styles.statVal, styles.statTeam, { color: muted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {game.home.char6 || home?.shortName}
          </Text>
        </RNView>
        {rows.map((r) => (
          <RNView key={r.label} style={styles.lsRow}>
            <Text style={styles.statVal}>{a ? r.get(a) : "–"}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>{r.label}</Text>
            <Text style={styles.statVal}>{h ? r.get(h) : "–"}</Text>
          </RNView>
        ))}
        {box.derived.faceoffs === "pbp" || box.derived.saves === "pbp" ? (
          <Text style={[styles.note, { color: muted }]}>
            Faceoffs/saves derived from play-by-play
          </Text>
        ) : null}
      </Card>
      {[away, home].map((t) =>
        t ? (
          <PlayerTable
            key={t.teamId}
            name={t.name}
            players={box.players.filter((p) => p.teamId === t.teamId)}
            isWomen={isWomen}
          />
        ) : null,
      )}
    </>
  );
}

/** Last name from "First Last" or "Last, First". */
const lastName = (s: string) =>
  (s.includes(",") ? s.split(",")[0] : s).trim().split(/\s+/).pop()?.toLowerCase() ??
  "";

/**
 * NCAA box scores only publish a position for goalies; lax.com team rosters
 * have positions for everyone. Look them up by jersey number, then last name.
 */
function useRosterPositions(team: V1Team, game: V1Game) {
  const season = game.date.slice(0, 4);
  const key = team.seoName || team.shortName;
  const q = useV1<V1TeamDetail>(
    `team/${game.sport}/${game.division}/${key}/${season}`,
    useCallback(
      (s: AbortSignal) => fetchTeam(game.sport, game.division, key, season, s),
      [game.sport, game.division, key, season],
    ),
  );
  return useMemo(() => {
    const byNumber = new Map<string, string>();
    const byLast = new Map<string, string>();
    for (const p of q.data?.roster ?? []) {
      if (!p.position) continue;
      if (p.number) byNumber.set(p.number, p.position);
      const ln = lastName(p.name);
      byLast.set(ln, byLast.has(ln) ? "" : p.position);
    }
    return (p: V1PlayerLine) =>
      p.position ||
      (p.number !== null ? byNumber.get(String(p.number)) : undefined) ||
      byLast.get(lastName(p.name)) ||
      (p.isGoalie ? "G" : "");
  }, [q.data]);
}

function Rosters({ box, game }: { box: V1Boxscore; game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const positions = [
    useRosterPositions(game.away, game),
    useRosterPositions(game.home, game),
  ];
  const stripe = useThemeColor(
    { light: "#f2f2f4", dark: "#1c1c1e" },
    "background",
  );
  const sides = [game.away, game.home];

  const lists = sides.map((team) =>
    box.players
      .filter((p) => p.teamId === team.id)
      .sort(
        (a, b) =>
          (a.number ?? Infinity) - (b.number ?? Infinity) ||
          a.name.localeCompare(b.name),
      ),
  );
  if (lists.every((l) => l.length === 0)) {
    return (
      <Text style={[styles.note, { color: muted, textAlign: "center" }]}>
        Rosters have not been published for this game.
      </Text>
    );
  }
  const rows = Math.max(lists[0].length, lists[1].length);
  return (
    <RNView>
      {Array.from({ length: rows }, (_, i) => (
        <RNView
          key={i}
          style={[styles.rosterRow, i % 2 ? { backgroundColor: stripe } : null]}
        >
          {lists.map((players, col) => {
            const player = players[i];
            return (
              <RNView key={col} style={styles.rosterCell}>
                <Text style={styles.rosterNumber} numberOfLines={1}>
                  {player?.number ?? ""}
                </Text>
                <Text style={[styles.rosterPosition, { color: muted }]}>
                  {player ? positions[col](player) : ""}
                </Text>
                <Text style={styles.rosterName} numberOfLines={1}>
                  {player ? titleCase(player.name) : ""}
                </Text>
              </RNView>
            );
          })}
        </RNView>
      ))}
    </RNView>
  );
}

function PlayerTable({
  name,
  players,
  isWomen,
}: {
  name: string;
  players: V1PlayerLine[];
  isWomen: boolean;
}) {
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const field = players
    .filter((p) => !p.isGoalie && (p.played || p.points > 0))
    .sort((x, y) => y.points - x.points || y.goals - x.goals);
  const goalies = players.filter((p) => p.isGoalie && p.played);
  const cols = isWomen
    ? ["G", "A", "P", "SH", "GB", "DC", "CT"]
    : ["G", "A", "P", "SH", "GB", "FO", "CT"];
  const val = (p: V1PlayerLine, c: string) =>
    ({
      G: n(p.goals),
      A: n(p.assists),
      P: n(p.points),
      SH: n(p.shots),
      GB: n(p.groundBalls),
      DC: n(p.drawControls),
      FO: p.faceoffsTaken ? `${p.faceoffsWon}-${p.faceoffsTaken}` : "–",
      CT: n(p.causedTurnovers),
    })[c] ?? "–";
  return (
    <Card title={name}>
      <RNView
        style={[
          styles.pRow,
          {
            borderBottomColor: border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Text style={[styles.pName, { color: muted }]}>Player</Text>
        {cols.map((c) => (
          <Text key={c} style={[styles.pCell, { color: muted }]}>
            {c}
          </Text>
        ))}
      </RNView>
      {field.map((p) => (
        <RNView key={`${p.number}-${p.name}`} style={styles.pRow}>
          <Text style={styles.pName} numberOfLines={1}>
            {p.number !== null ? `#${p.number} ` : ""}
            {titleCase(p.name)}
          </Text>
          {cols.map((c) => (
            <Text key={c} style={styles.pCell}>
              {val(p, c)}
            </Text>
          ))}
        </RNView>
      ))}
      {goalies.length ? (
        <>
          <RNView
            style={[
              styles.pRow,
              {
                marginTop: 8,
                borderBottomColor: border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={[styles.pName, { color: muted }]}>Goalie</Text>
            <Text style={[styles.pCell, { color: muted }]}>SV</Text>
            <Text style={[styles.pCell, { color: muted }]}>GA</Text>
          </RNView>
          {goalies.map((p) => (
            <RNView key={`${p.number}-${p.name}`} style={styles.pRow}>
              <Text style={styles.pName} numberOfLines={1}>
                {p.number !== null ? `#${p.number} ` : ""}
                {titleCase(p.name)}
              </Text>
              <Text style={styles.pCell}>{n(p.saves)}</Text>
              <Text style={styles.pCell}>{n(p.goalsAllowed)}</Text>
            </RNView>
          ))}
        </>
      ) : null}
      {field.length === 0 && goalies.length === 0 ? (
        <Text style={[styles.note, { color: muted }]}>
          No player stats yet.
        </Text>
      ) : null}
    </Card>
  );
}

/** CHN-style scoring summary: goals by period with scorer, assists and running score. */
function Goals({ plays, game }: { plays: V1Plays; game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const goals = useMemo(
    () => plays.plays.filter((p) => p.type === "goal"),
    [plays.plays],
  );
  const side = (teamId: string | null): V1Team | null =>
    teamId === game.home.id
      ? game.home
      : teamId === game.away.id
        ? game.away
        : null;
  return (
    <RNView>
      {goals.length === 0 ? (
        <Text style={[styles.note, { color: muted, textAlign: "center" }]}>
          No goals yet.
        </Text>
      ) : null}
      {goals.map((p, i) => {
        const showPeriod = i === 0 || p.period !== goals[i - 1].period;
        const t = side(p.teamId);
        const scorer = titleCase(firstLast(p.scorer ?? p.text));
        const tags = p.tags.filter(
          (t) => t !== "unassisted" && t !== "first-goal",
        );
        const periodLabel =
          p.period >= 1 && p.period <= 4
            ? `QUARTER ${p.period}`
            : p.period === 5
              ? "OVERTIME"
              : p.period > 5
                ? `OVERTIME ${p.period - 4}`
                : p.periodDisplay.toUpperCase();
        return (
          <RNView key={p.id}>
            {showPeriod ? (
              <RNView
                style={[styles.periodBar, { backgroundColor: brand.navy }]}
              >
                <Text style={styles.periodBarText}>{periodLabel}</Text>
              </RNView>
            ) : null}
            <RNView style={styles.goalRow}>
              <TeamLogo
                seoName={t?.seoName}
                fallback={t?.char6 ?? "?"}
                size={30}
              />
              <RNView style={{ flex: 1 }}>
                <Text style={styles.goalScorer}>
                  {p.clock} {scorer}
                  {tags.length ? (
                    <Text style={{ color: muted, fontWeight: "400" }}>
                      {" "}
                      ({tags.join(", ")})
                    </Text>
                  ) : null}
                </Text>
                <Text style={[styles.goalAssist, { color: muted }]}>
                  <Text style={{ color: brand.red, fontWeight: "700" }}>
                    {p.awayScore ?? "–"}
                  </Text>
                  {" - "}
                  <Text style={{ color: brand.red, fontWeight: "700" }}>
                    {p.homeScore ?? "–"}
                  </Text>
                  {"  "}
                  {p.assist ? titleCase(firstLast(p.assist)) : "Unassisted"}
                </Text>
              </RNView>
            </RNView>
          </RNView>
        );
      })}
    </RNView>
  );
}

function Plays({ plays }: { plays: V1Plays }) {
  const muted = useThemeColor({}, "muted");
  const border = useThemeColor({}, "border");
  const team = (id: string | null) =>
    plays.teams.find((t) => t.teamId === id)?.shortName ?? "";
  const ordered = useMemo(() => [...plays.plays].reverse(), [plays.plays]);
  return (
    <Card title="Play-by-play">
      {ordered.length === 0 ? (
        <Text style={[styles.note, { color: muted }]}>No plays yet.</Text>
      ) : null}
      {ordered.map((p, i) => {
        const showPeriod = i === 0 || p.period !== ordered[i - 1].period;
        const goal = p.type === "goal";
        return (
          <RNView key={p.id}>
            {showPeriod ? (
              <Text
                style={[
                  styles.periodHead,
                  { color: muted, borderBottomColor: border },
                ]}
              >
                {p.periodDisplay}
              </Text>
            ) : null}
            <RNView style={styles.playRow}>
              <Text style={[styles.playClock, { color: muted }]}>
                {p.clock}
              </Text>
              <RNView style={{ flex: 1 }}>
                <Text style={[styles.playText, goal && { fontWeight: "700" }]}>
                  {goal ? "GOAL " : ""}
                  {team(p.teamId) ? `${team(p.teamId)}: ` : ""}
                  {p.text}
                </Text>
                {goal && p.homeScore !== null ? (
                  <Text style={[styles.note, { color: muted }]}>
                    {p.awayScore} – {p.homeScore}
                    {p.tags.length ? ` · ${p.tags.join(", ")}` : ""}
                  </Text>
                ) : null}
              </RNView>
            </RNView>
          </RNView>
        );
      })}
    </Card>
  );
}

function Info({ game }: { game: V1Game }) {
  const muted = useThemeColor({}, "muted");
  const rows: [string, string | null][] = [
    [
      "Venue",
      game.venue
        ? `${game.venue.name}${game.venue.city ? ` — ${game.venue.city}, ${game.venue.state}` : ""}`
        : null,
    ],
    [
      "Attendance",
      game.attendance !== null ? game.attendance.toLocaleString() : null,
    ],
    ["TV", game.broadcast.network],
    ["Start", game.startTime || null],
    ["Round", game.bracket?.roundDescription ?? null],
    ["Conference", game.home.conference],
  ];
  return (
    <Card title="Game info">
      {rows.map(([k, v]) => (
        <RNView key={k} style={styles.lsRow}>
          <Text
            style={[
              styles.statLabel,
              { color: muted, textAlign: "left", flex: 0, width: 100 },
            ]}
          >
            {k}
          </Text>
          <Text style={{ flex: 1 }}>{v ?? "Not published"}</Text>
        </RNView>
      ))}
    </Card>
  );
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("rosters");
  const muted = useThemeColor({}, "muted");
  const tint = useThemeColor({}, "tint");

  const gameQ = useV1<V1Game>(
    `game/${id}`,
    useCallback((s: AbortSignal) => fetchGame(id, s), [id]),
  );
  const [patch, setPatch] = useState<GameEvent | null>(null);
  const game = useMemo<V1Game | null>(() => {
    const g = gameQ.data;
    if (!g) return null;
    if (!patch || patch.gameId !== g.id || patch.at <= g.updatedAt) return g;
    return {
      ...g,
      status: patch.status,
      home: { ...g.home, score: patch.home.score },
      away: { ...g.away, score: patch.away.score },
      linescore: patch.linescore ?? g.linescore,
      updatedAt: patch.at,
    };
  }, [gameQ.data, patch]);
  const live = game?.status.state === "live";

  const boxQ = useV1<V1Boxscore | null>(
    `box/${id}`,
    useCallback((s: AbortSignal) => fetchBoxscore(id, s), [id]),
    live ? 60_000 : null,
  );
  const playsQ = useV1<V1Plays | null>(
    `plays/${id}`,
    useCallback((s: AbortSignal) => fetchPlays(id, s), [id]),
    live ? 60_000 : null,
  );

  const refreshBox = boxQ.refresh;
  const refreshPlays = playsQ.refresh;
  const refreshGame = gameQ.refresh;

  useGameStream(
    { game: id },
    useCallback(
      (ev: GameEvent) => {
        if (ev.type === "game.details") {
          refreshBox();
          refreshPlays();
          return;
        }
        setPatch(ev);
        if (ev.type === "game.state") refreshGame();
      },
      [refreshBox, refreshPlays, refreshGame],
    ),
    live || game?.status.state === "pre",
  );

  const inBoxScore = tab === "box" || tab === "plays" || tab === "info";
  const title = game
    ? `${game.sport === "lacrosse-men" ? "M" : "W"}: ${new Date(`${game.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`
    : "Game";

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: inBoxScore ? "Box Score" : title,
          headerLeft: inBoxScore
            ? () => (
                <Pressable
                  onPress={() => setTab("rosters")}
                  accessibilityRole="button"
                  accessibilityLabel="Back to rosters"
                >
                  <Text style={[styles.headerAction, { color: tint }]}>
                    ‹ Back
                  </Text>
                </Pressable>
              )
            : undefined,
          headerRight: !inBoxScore
            ? () => (
                <RNView style={styles.headerRight}>
                  <Pressable
                    onPress={() => setTab("box")}
                    accessibilityRole="button"
                    accessibilityLabel="Box Score"
                  >
                    <Text style={[styles.headerAction, { color: tint }]}>
                      Box Score
                    </Text>
                  </Pressable>
                </RNView>
              )
            : undefined,
        }}
      />
      <ScrollView key={tab} contentContainerStyle={styles.content}>
        {game ? (
          <Header game={game} />
        ) : (
          <Text style={[styles.note, { color: muted, textAlign: "center" }]}>
            {gameQ.error ?? "Loading…"}
          </Text>
        )}
        <RNView style={{ marginHorizontal: 12, marginBottom: 6 }}>
          <Segmented<Tab>
            options={
              inBoxScore
                ? [
                    { key: "box", label: "Box score" },
                    { key: "plays", label: "Plays" },
                    { key: "info", label: "Info" },
                  ]
                : [
                    { key: "rosters", label: "Rosters" },
                    { key: "goals", label: "Goals" },
                  ]
            }
            value={tab}
            onChange={setTab}
          />
        </RNView>
        {tab === "rosters" && game ? (
          boxQ.data ? (
            <Rosters box={boxQ.data} game={game} />
          ) : (
            <Text style={[styles.note, { color: muted, textAlign: "center" }]}>
              {boxQ.loading
                ? "Loading rosters…"
                : "Rosters have not been published for this game."}
            </Text>
          )
        ) : null}
        {tab === "box" && game ? (
          boxQ.data ? (
            <>
              {game.linescore.length > 0 ? <Linescore game={game} /> : null}
              <Boxscore box={boxQ.data} game={game} />
            </>
          ) : (
            <Card>
              <Text style={[styles.note, { color: muted }]}>
                {boxQ.loading
                  ? "Loading box score…"
                  : "Box score not available for this game."}
              </Text>
            </Card>
          )
        ) : null}
        {tab === "goals" && game ? (
          playsQ.data ? (
            <Goals plays={playsQ.data} game={game} />
          ) : (
            <Text style={[styles.note, { color: muted, textAlign: "center" }]}>
              {playsQ.loading
                ? "Loading scoring…"
                : "Scoring summary not available for this game."}
            </Text>
          )
        ) : null}
        {tab === "plays" ? (
          playsQ.data ? (
            <Plays plays={playsQ.data} />
          ) : (
            <Card>
              <Text style={[styles.note, { color: muted }]}>
                {playsQ.loading
                  ? "Loading plays…"
                  : "Play-by-play not available for this game."}
              </Text>
            </Card>
          )
        ) : null}
        {tab === "info" && game ? <Info game={game} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerAction: { fontSize: 16, fontWeight: "600" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  header: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
    overflow: "hidden",
  },
  watermark: { position: "absolute", top: -6, opacity: 0.18 },
  content: { paddingBottom: 32 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  status: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  scoreRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  team: { flex: 1, alignItems: "center" },
  rank: { fontSize: 12, fontWeight: "700", color: "#3779be", lineHeight: 14 },
  teamName: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
  scoreMid: { alignItems: "center", minWidth: 120, paddingTop: 36 },
  venue: { fontSize: 12, textAlign: "center", marginTop: 2 },
  periodBar: {
    paddingVertical: 2,
    marginTop: 6,
    marginBottom: 2,
    alignItems: "center",
  },
  periodBarText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  goalScorer: { fontSize: 15, fontWeight: "800" },
  goalAssist: { fontSize: 12, marginTop: 1 },
  record: { fontSize: 12 },
  bigScore: {
    fontSize: 32,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  linescore: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lsRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  lsTeam: { flex: 1, fontWeight: "600", fontSize: 13 },
  lsCell: { width: 34, textAlign: "center", fontVariant: ["tabular-nums"] },
  lsTotal: { fontWeight: "700" },
  statVal: {
    width: 64,
    textAlign: "center",
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  statTeam: { fontSize: 11 },
  statLabel: { flex: 1, textAlign: "center", fontSize: 13 },
  rosterRow: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6 },
  rosterCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  rosterNumber: {
    width: 22,
    textAlign: "right",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  rosterPosition: { width: 26, fontSize: 12 },
  rosterName: { flex: 1, fontSize: 12 },
  pRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  pName: { flex: 1, fontSize: 13 },
  pCell: {
    width: 36,
    textAlign: "center",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  periodHead: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playRow: { flexDirection: "row", gap: 10, paddingVertical: 4 },
  playClock: {
    width: 44,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    paddingTop: 2,
  },
  playText: { fontSize: 14 },
  note: { fontSize: 12, marginTop: 6 },
});
