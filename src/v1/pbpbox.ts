import { nameKey } from "./normalize";
import type {
	V1Boxscore,
	V1Game,
	V1Play,
	V1PlayerLine,
	V1TeamLine,
} from "./types";

const GOAL_RE =
	/^GOAL by \S+ (.+?)(?: \(.*?\))?(?:, Assist by (.+?))?(?:, goal number .*)?\.?$/i;
/** "(FPGOAL) {free position shot}", "(MAN-UP)", "(FIRST GOAL)" tags NCAA appends to goal text. */
const ANNOTATION_RE = /\s*(?:\([^)]*\)|\{[^}]*\})/g;
const SAVE_RE = /^Shot by \S+ (.+?),\s*SAVE (?:by )?(.+?)\s*$/i;
const SHOT_RE =
	/^Shot by \S+ (.+?)(?: (?:WIDE|HIGH|HIT POST|BLOCKED|HIT CROSSBAR).*)?$/i;
const FACEOFF_RE = /^Faceoff (.+?) vs (.+?) won by (\S+)/i;
const GB_RE = /Ground ball pickup by \S+ ([^.]+)/gi;
const TURNOVER_RE = /^Turnover by \S+ ([^(]+?)(?:\s*\(caused by (.+?)\))?\.?$/i;
const PENALTY_RE = /^Penalty on \S+ (.+?) \(.*?\/(\d+):(\d{2})\)/i;
const GOALIE_RE = /^(.+?) at goalie for (\S+)/i;
const DRAW_RE = /^Draw control (?:won )?by \S+ (.+?)\.?$/i;

/**
 * True when NCAA published a box score with no stats at all (every player and
 * team line is zero) for a game whose play-by-play has goals — common for
 * older seasons, where only the PBP was ever filled in.
 */
export function boxscoreIsEmpty(box: V1Boxscore, plays: V1Play[]): boolean {
	if (!plays.some((p) => p.type === "goal")) return false;
	// saves/faceoffs are already PBP-derived by normalizeBoxscore, so only
	// fields that come straight from the NCAA box count here.
	const teamZero = box.teamStats.every(
		(t) => !t.goals && !t.shots && !t.groundBalls && !t.turnovers,
	);
	const playerZero = box.players.every(
		(p) => !p.goals && !p.assists && !p.shots && !p.groundBalls,
	);
	return teamZero && playerZero;
}

/**
 * True for a final whose NCAA box score disagrees with the final score while
 * the (deduped) play-by-play agrees with it — NCAA's 2022 feeds carry boxes
 * that are doubled or stop part-way through the game. Such a box is rebuilt
 * from the plays.
 */
export function boxscoreDisagrees(
	box: V1Boxscore,
	plays: V1Play[],
	game: Pick<V1Game, "home" | "away" | "status">,
): boolean {
	if (game.status.state !== "final") return false;
	if (!game.home.id || !game.away.id) return false;
	const final: Record<string, number | null> = {
		[game.home.id]: game.home.score,
		[game.away.id]: game.away.score,
	};
	if (Object.values(final).some((s) => s === null)) return false;
	const pbp = new Map<string, number>();
	for (const p of plays)
		if (p.type === "goal" && p.teamId)
			pbp.set(p.teamId, (pbp.get(p.teamId) ?? 0) + 1);
	if (pbp.size === 0) return false;
	for (const id of Object.keys(final))
		if ((pbp.get(id) ?? 0) !== final[id]) return false;
	const players = new Map<string, number>();
	for (const p of box.players)
		players.set(p.teamId, (players.get(p.teamId) ?? 0) + p.goals);
	return Object.keys(final).some(
		(id) =>
			(box.teamStats.find((t) => t.teamId === id)?.goals ?? final[id]) !==
				final[id] || (players.get(id) ?? 0) !== final[id],
	);
}

/**
 * True when the box carries no statistics at all: no player lines, or a
 * roster-only box where every player and team line is zero (NCAA publishes
 * these for games it never scored).
 */
export function boxscoreIsBlank(box: V1Boxscore): boolean {
	return (
		box.teamStats.every(
			(t) => !t.goals && !t.shots && !t.groundBalls && !t.turnovers,
		) &&
		box.players.every(
			(p) => !p.goals && !p.assists && !p.shots && !p.groundBalls && !p.saves,
		)
	);
}

function displayName(name: string): string {
	const comma = name.indexOf(",");
	if (comma < 0) return name.trim();
	return `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
}

/** Uppercase tokens of both team names ("PALM BEACH ATL." → PALM, BEACH, ATL). */
function teamWords(box: Pick<V1Boxscore, "teams">): Set<string> {
	const words = new Set<string>();
	for (const t of box.teams)
		for (const w of `${t.name} ${t.shortName}`.toUpperCase().split(/\s+/)) {
			const clean = w.replace(/[^A-Z&]/g, "");
			if (clean) words.add(clean);
		}
	return words;
}

/**
 * NCAA play text is "GOAL by <TEAM> <player>" where <TEAM> may be several
 * words ("PALM BEACH ATL."); the regexes only skip the first. Drop further
 * leading all-caps tokens that belong to a team name, keeping ≥2 for the player.
 */
function stripTeamWords(name: string, words: Set<string>): string {
	const parts = name.trim().split(/\s+/);
	while (parts.length > 2) {
		const w = parts[0];
		const clean = w.replace(/[^A-Z&]/g, "");
		if (w !== w.toUpperCase() || w.includes(",") || !words.has(clean)) break;
		parts.shift();
	}
	return parts.join(" ");
}

function newLine(teamId: string, name: string, goalie: boolean): V1PlayerLine {
	const parts = name.split(" ");
	return {
		teamId,
		name,
		firstName: parts[0] ?? "",
		lastName: parts.slice(1).join(" "),
		number: null,
		position: goalie ? "G" : "",
		starter: false,
		played: true,
		goals: 0,
		assists: 0,
		points: 0,
		shots: 0,
		shotsOnGoal: 0,
		groundBalls: 0,
		turnovers: 0,
		causedTurnovers: 0,
		drawControls: 0,
		faceoffsWon: null,
		faceoffsTaken: null,
		saves: goalie ? 0 : null,
		goalsAllowed: goalie ? 0 : null,
		isGoalie: goalie,
		penalties: null,
	};
}

/**
 * Player lines synthesized from the names that appear in the play-by-play,
 * for games where NCAA published no player box at all. Only plays whose
 * actor's team is unambiguous contribute a name.
 */
export function rosterFromPlays(
	box: V1Boxscore,
	plays: V1Play[],
): V1PlayerLine[] {
	const teamIds = box.teams.map((t) => t.teamId);
	const other = (teamId: string) => teamIds.find((t) => t !== teamId) ?? null;
	const seen = new Map<string, V1PlayerLine>();
	const words = teamWords(box);
	const add = (
		teamId: string | null,
		raw: string | undefined,
		goalie = false,
	) => {
		if (!teamId || !raw) return;
		const name = displayName(
			stripTeamWords(raw.trim().replace(/\.$/, ""), words),
		);
		if (!name || /^team$/i.test(name)) return;
		const key = `${teamId}|${nameKey(name)}`;
		const cur = seen.get(key);
		if (cur) {
			if (goalie) cur.isGoalie = true;
			return;
		}
		seen.set(key, newLine(teamId, name, goalie));
	};
	for (const play of plays) {
		const text = play.text.replace(/\s+/g, " ").trim();
		const team = play.teamId;
		const goalie = text.match(GOALIE_RE);
		if (goalie) {
			add(team, goalie[1], true);
			continue;
		}
		const otherTeam = team ? other(team) : null;
		const rules: [RegExp, (m: RegExpMatchArray) => void][] = [
			[
				GOAL_RE,
				(m) => {
					add(team, m[1]);
					add(team, m[2]);
				},
			],
			[
				SAVE_RE,
				(m) => {
					add(team, m[1]);
					add(otherTeam, m[2], true);
				},
			],
			[SHOT_RE, (m) => add(team, m[1])],
			[
				TURNOVER_RE,
				(m) => {
					add(team, m[1]);
					add(otherTeam, m[2]);
				},
			],
			[PENALTY_RE, (m) => add(team, m[1])],
			[DRAW_RE, (m) => add(team, m[1])],
		];
		const hit = rules.find(([re]) => re.test(text));
		if (hit) {
			const m = text.match(hit[0]);
			if (m) hit[1](m);
			continue;
		}
		for (const gb of text.matchAll(GB_RE)) add(team, gb[1]);
	}
	return [...seen.values()].sort(
		(a, b) =>
			teamIds.indexOf(a.teamId) - teamIds.indexOf(b.teamId) ||
			a.lastName.localeCompare(b.lastName),
	);
}

/**
 * Rebuild a partial box score from the plays released so far, keyed to the
 * roster of the stored final box (so names, numbers and positions match).
 * With `everything`, fields the final left null (faceoffs, saves, penalties,
 * clears) are derived too — used to repair an empty NCAA box.
 */
export function boxscoreFromPlays(
	final: V1Boxscore,
	plays: V1Play[],
	status: V1Boxscore["status"],
	updatedAt: string,
	everything = false,
): V1Boxscore {
	const players: V1PlayerLine[] = final.players.map((p) => ({
		...p,
		played: false,
		goals: 0,
		assists: 0,
		points: 0,
		shots: 0,
		shotsOnGoal: 0,
		groundBalls: 0,
		turnovers: 0,
		causedTurnovers: 0,
		drawControls: 0,
		faceoffsWon: p.faceoffsWon === null && !everything ? null : 0,
		faceoffsTaken: p.faceoffsTaken === null && !everything ? null : 0,
		saves: p.isGoalie ? 0 : p.saves === null ? null : 0,
		goalsAllowed: p.isGoalie ? 0 : p.goalsAllowed === null ? null : 0,
		penalties: p.penalties || everything ? { count: 0, minutes: 0 } : null,
	}));
	const byKey = new Map<string, V1PlayerLine>();
	for (const p of players) byKey.set(`${p.teamId}|${nameKey(p.name)}`, p);
	const teamIds = final.teams.map((t) => t.teamId);
	const other = (teamId: string) => teamIds.find((t) => t !== teamId) ?? "";
	const words = teamWords(final);
	const lookup = (teamId: string | null, name: string) => {
		const key = nameKey(name);
		if (teamId) {
			const hit = byKey.get(`${teamId}|${key}`);
			if (hit) return hit;
		}
		for (const t of teamIds) {
			const hit = byKey.get(`${t}|${key}`);
			if (hit) return hit;
		}
		return null;
	};
	const find = (teamId: string | null, name: string) =>
		lookup(teamId, name) ?? lookup(teamId, stripTeamWords(name, words));
	/** Like find, but when rebuilding everything an unknown scorer gets a new line. */
	const findOrAdd = (teamId: string | null, name: string) => {
		const hit = find(teamId, name);
		if (hit || !everything || !teamId) return hit;
		const clean = displayName(
			stripTeamWords(name.trim().replace(/\.$/, ""), words),
		);
		if (!clean || /^team$/i.test(clean)) return null;
		const line = newLine(teamId, clean, false);
		players.push(line);
		byKey.set(`${teamId}|${nameKey(clean)}`, line);
		return line;
	};
	const isGoalie = (p: V1PlayerLine) =>
		p.isGoalie || /^(g|gk|goal)/i.test(p.position);
	const goalieFor = new Map<string, V1PlayerLine>();
	for (const t of teamIds) {
		const g = players.filter((p) => p.teamId === t && isGoalie(p));
		if (g.length === 1) goalieFor.set(t, g[0]);
	}
	const clears = new Map<string, { good: number; attempts: number }>();
	const touch = (p: V1PlayerLine | null) => {
		if (p) p.played = true;
		return p;
	};

	for (const play of plays) {
		const text = play.text.replace(/\s+/g, " ").trim();
		const team = play.teamId;
		const goalie = text.match(GOALIE_RE);
		if (goalie) {
			const g = touch(find(team, goalie[1]));
			if (g) {
				g.isGoalie = true;
				g.saves ??= 0;
				g.goalsAllowed ??= 0;
				if (team) goalieFor.set(team, g);
			}
			continue;
		}
		const clear = text.match(/^Clear attempt by \S+ (good|failed)/i);
		if (clear && team) {
			const c = clears.get(team) ?? { good: 0, attempts: 0 };
			c.attempts++;
			if (clear[1].toLowerCase() === "good") c.good++;
			clears.set(team, c);
			continue;
		}
		const fo = text.match(FACEOFF_RE);
		if (fo) {
			const a = touch(find(null, fo[1]));
			const b = touch(find(null, fo[2]));
			for (const p of [a, b]) {
				if (p) p.faceoffsTaken = (p.faceoffsTaken ?? 0) + 1;
			}
			const winner =
				a && a.teamId === team ? a : b && b.teamId === team ? b : null;
			if (winner) winner.faceoffsWon = (winner.faceoffsWon ?? 0) + 1;
			for (const gb of text.matchAll(GB_RE)) {
				const p = touch(find(team, gb[1]));
				if (p) p.groundBalls++;
			}
			continue;
		}
		switch (play.type) {
			case "goal": {
				const m = text.replace(ANNOTATION_RE, "").match(GOAL_RE);
				if (!m) break;
				const scorer = touch(findOrAdd(team, m[1]));
				if (scorer) {
					scorer.goals++;
					scorer.shots++;
					scorer.shotsOnGoal++;
					scorer.points++;
				}
				if (m[2]) {
					const a = touch(findOrAdd(team, m[2]));
					if (a) {
						a.assists++;
						a.points++;
					}
				}
				const g = team ? goalieFor.get(other(team)) : null;
				if (g) g.goalsAllowed = (g.goalsAllowed ?? 0) + 1;
				break;
			}
			case "save": {
				const m = text.match(SAVE_RE);
				if (!m) break;
				const shooter = touch(find(team, m[1]));
				if (shooter) {
					shooter.shots++;
					shooter.shotsOnGoal++;
				}
				const g =
					touch(find(team ? other(team) : null, m[2])) ??
					(team ? (goalieFor.get(other(team)) ?? null) : null);
				if (g) {
					g.isGoalie = true;
					g.saves = (g.saves ?? 0) + 1;
					g.goalsAllowed ??= 0;
				}
				break;
			}
			case "shot": {
				const m = text.match(SHOT_RE);
				const shooter = m ? touch(find(team, m[1])) : null;
				if (shooter) shooter.shots++;
				break;
			}
			case "groundball": {
				for (const gb of text.matchAll(GB_RE)) {
					const p = touch(find(team, gb[1]));
					if (p) p.groundBalls++;
				}
				break;
			}
			case "turnover": {
				const m = text.match(TURNOVER_RE);
				if (!m) break;
				const p = touch(find(team, m[1].trim()));
				if (p) p.turnovers++;
				if (m[2]) {
					const c = touch(find(team ? other(team) : null, m[2]));
					if (c) c.causedTurnovers++;
				}
				break;
			}
			case "penalty": {
				const m = text.match(PENALTY_RE);
				if (!m) break;
				const p = touch(find(team, m[1]));
				if (p) {
					const cur = p.penalties ?? { count: 0, minutes: 0 };
					p.penalties = {
						count: cur.count + 1,
						minutes: cur.minutes + Number(m[2]) + Number(m[3]) / 60,
					};
				}
				break;
			}
			default: {
				const m = text.match(DRAW_RE);
				if (m) {
					const p = touch(find(team, m[1]));
					if (p) p.drawControls++;
				}
			}
		}
	}

	const teamStats: V1TeamLine[] = final.teamStats.map((orig) => {
		const line: V1TeamLine = everything
			? {
					...orig,
					faceoffsWon: 0,
					faceoffsLost: 0,
					clears: 0,
					clearAttempts: 0,
					saves: 0,
					goalsAllowed: 0,
					penalties: { count: 0, minutes: 0 },
				}
			: orig;
		const mine = players.filter((p) => p.teamId === line.teamId);
		const theirs = players.filter((p) => p.teamId !== line.teamId);
		const sum = (f: (p: V1PlayerLine) => number | null) =>
			mine.reduce((n, p) => n + (f(p) ?? 0), 0);
		const c = clears.get(line.teamId);
		const pbpGoals = plays.filter(
			(p) => p.type === "goal" && p.teamId === line.teamId,
		).length;
		return {
			...line,
			goals: Math.max(
				sum((p) => p.goals),
				pbpGoals,
			),
			assists: sum((p) => p.assists),
			shots: sum((p) => p.shots),
			shotsOnGoal: sum((p) => p.shotsOnGoal),
			groundBalls: sum((p) => p.groundBalls),
			turnovers: sum((p) => p.turnovers),
			causedTurnovers: sum((p) => p.causedTurnovers),
			drawControls:
				line.drawControls === null ? null : sum((p) => p.drawControls),
			faceoffsWon: line.faceoffsWon === null ? null : sum((p) => p.faceoffsWon),
			faceoffsLost:
				line.faceoffsLost === null
					? null
					: theirs.reduce((n, p) => n + (p.faceoffsWon ?? 0), 0),
			clears: line.clears === null ? null : (c?.good ?? 0),
			clearAttempts: line.clearAttempts === null ? null : (c?.attempts ?? 0),
			saves: line.saves === null ? null : sum((p) => p.saves),
			goalsAllowed:
				line.goalsAllowed === null ? null : sum((p) => p.goalsAllowed),
			penalties: line.penalties
				? {
						count: sum((p) => p.penalties?.count ?? 0),
						minutes:
							Math.round(sum((p) => p.penalties?.minutes ?? 0) * 100) / 100,
					}
				: null,
			extraMan: line.extraMan ? { goals: 0, opportunities: 0 } : null,
		};
	});

	const derived = everything
		? {
				faceoffs: "pbp" as const,
				saves: "pbp" as const,
				clears: "pbp" as const,
				groundBalls: players.some((p) => p.groundBalls > 0)
					? ("pbp" as const)
					: ("none" as const),
				turnovers: players.some((p) => p.turnovers > 0)
					? ("pbp" as const)
					: ("none" as const),
			}
		: final.derived;
	return { ...final, status, players, teamStats, derived, updatedAt };
}
