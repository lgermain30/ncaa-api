import type { V1Game } from "./types";

/*
 * In-process change feed behind GET /v1/stream (SSE).
 *
 * The service publishes every stored game (previous, next) pair; we diff them
 * into small typed events and fan them out to connected subscribers. A short
 * ring buffer lets a reconnecting client pass Last-Event-ID and catch up on
 * anything it missed instead of refetching the board.
 *
 * Single-process by design: Railway runs one instance and the poller lives in
 * the same process, so every change passes through here.
 */

export type GameEventType =
	| "game.new"
	| "game.state"
	| "game.score"
	| "game.clock"
	| "game.linescore"
	| "game.details";

export interface GameEvent {
	id: number;
	type: GameEventType;
	at: string;
	gameId: string;
	sport: string;
	division: string;
	date: string;
	status: V1Game["status"];
	home: { id: string | null; name: string; score: number | null };
	away: { id: string | null; name: string; score: number | null };
	/** Set on game.score: which side scored and by how much. */
	scored?: { side: "home" | "away"; by: number };
	/** Set on game.state: the state we left. */
	previousState?: V1Game["status"]["state"];
	/** Set on game.linescore. */
	linescore?: V1Game["linescore"];
	/** Set on game.details: which detail documents were refreshed. */
	details?: ("boxscore" | "plays")[];
}

export interface StreamFilter {
	sport?: string;
	division?: string;
	date?: string;
	gameId?: string;
}

type Listener = (event: GameEvent) => void;

const BUFFER_SIZE = Number(process.env.STREAM_BUFFER) || 500;

const listeners = new Set<Listener>();
const buffer: GameEvent[] = [];
let seq = 0;

export const eventStats = {
	published: 0,
	subscribers: 0,
	lastEventAt: null as string | null,
};

function teamSummary(t: V1Game["home"]) {
	return { id: t.id, name: t.name, score: t.score };
}

function base(game: V1Game, type: GameEventType): Omit<GameEvent, "id" | "at"> {
	return {
		type,
		gameId: game.id,
		sport: game.sport,
		division: game.division,
		date: game.date,
		status: game.status,
		home: teamSummary(game.home),
		away: teamSummary(game.away),
	};
}

function sameLinescore(a: V1Game["linescore"], b: V1Game["linescore"]) {
	if (a.length !== b.length) return false;
	return a.every(
		(p, i) =>
			p.period === b[i].period && p.home === b[i].home && p.away === b[i].away,
	);
}

/** Pure diff: which events does moving from `previous` to `next` produce? */
export function diffGame(
	previous: V1Game | null,
	next: V1Game,
): Omit<GameEvent, "id" | "at">[] {
	if (!previous) return [base(next, "game.new")];
	const out: Omit<GameEvent, "id" | "at">[] = [];

	if (previous.status.state !== next.status.state) {
		out.push({
			...base(next, "game.state"),
			previousState: previous.status.state,
		});
	}

	for (const side of ["home", "away"] as const) {
		const before = previous[side].score;
		const after = next[side].score;
		if (after !== null && before !== null && after > before) {
			out.push({
				...base(next, "game.score"),
				scored: { side, by: after - before },
			});
		} else if (after !== null && before === null && after > 0) {
			out.push({ ...base(next, "game.score"), scored: { side, by: after } });
		}
	}

	// state/score events already carry the new period + clock
	if (
		next.status.state === "live" &&
		out.length === 0 &&
		(previous.status.period !== next.status.period ||
			previous.status.clock !== next.status.clock)
	) {
		out.push(base(next, "game.clock"));
	}

	if (!sameLinescore(previous.linescore, next.linescore)) {
		out.push({ ...base(next, "game.linescore"), linescore: next.linescore });
	}

	return out;
}

function emit(partial: Omit<GameEvent, "id" | "at">) {
	const event: GameEvent = {
		...partial,
		id: ++seq,
		at: new Date().toISOString(),
	};
	buffer.push(event);
	if (buffer.length > BUFFER_SIZE)
		buffer.splice(0, buffer.length - BUFFER_SIZE);
	eventStats.published++;
	eventStats.lastEventAt = event.at;
	for (const l of listeners) {
		try {
			l(event);
		} catch {
			// a broken subscriber must not take down the publisher
		}
	}
	return event;
}

/** Called by the service after every game upsert. */
export function publishGame(
	previous: V1Game | null,
	next: V1Game,
): GameEvent[] {
	return diffGame(previous, next).map(emit);
}

/** Called by the service after boxscore/plays are refreshed for a game. */
export function publishDetails(
	game: V1Game,
	details: ("boxscore" | "plays")[],
): GameEvent {
	return emit({ ...base(game, "game.details"), details });
}

export function matches(
	event: Pick<GameEvent, "gameId" | "sport" | "division" | "date">,
	f: StreamFilter,
): boolean {
	if (f.gameId && event.gameId !== f.gameId) return false;
	if (f.sport && event.sport !== f.sport) return false;
	if (f.division && event.division !== f.division) return false;
	if (f.date && event.date !== f.date) return false;
	return true;
}

export function matchesGame(game: V1Game, f: StreamFilter): boolean {
	return matches(
		{
			gameId: game.id,
			sport: game.sport,
			division: game.division,
			date: game.date,
		},
		f,
	);
}

/** Events after `lastId` (for Last-Event-ID replay). Empty if it fell out of the buffer. */
export function eventsSince(lastId: number, f: StreamFilter = {}): GameEvent[] {
	if (!buffer.length || lastId < (buffer[0]?.id ?? 0) - 1) return [];
	return buffer.filter((e) => e.id > lastId && matches(e, f));
}

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	eventStats.subscribers = listeners.size;
	return () => {
		listeners.delete(listener);
		eventStats.subscribers = listeners.size;
	};
}

export function lastEventId(): number {
	return seq;
}

/** Test hook. */
export function resetEvents() {
	listeners.clear();
	buffer.length = 0;
	seq = 0;
	eventStats.published = 0;
	eventStats.subscribers = 0;
	eventStats.lastEventAt = null;
}
