import { createHash } from "crypto";
import type {
  Contest,
  GraphQLResponse,
  NewScoreboardParams,
  OldFormatData,
  OldFormatGame,
  Team,
} from "./types";

export type {
  NewScoreboardParams,
  GraphQLResponse,
  Contest,
  Team,
  OldFormatData,
  OldFormatGame,
};

const instance_id = createHash("md5").digest("hex");

export async function fetchGqlScoreboard(params: NewScoreboardParams) {
  const url = `https://sdataprod.ncaa.com/?extensions={"persistedQuery":{"version":1,"sha256Hash":"7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c"}}&variables=${JSON.stringify(params)}`;

  const req = await fetch(url);
  if (!req.ok) {
    throw new Error("Failed to fetch NCAA scoreboard data");
  }

  return await req.json();
}

async function fetchGameDetails(gameID: string) {
  if (!gameID) return { linescores: [], venue: "", city: "", state: "", attendance: "", network: "" };

  try {
    const req = await fetch(
      `https://ncaa-api-production-1586.up.railway.app/game/${gameID}`
    );

    if (!req.ok) return { linescores: [], venue: "", city: "", state: "", attendance: "", network: "" };

    const data = await req.json();
    console.log(
  "GAME DETAILS:",
  JSON.stringify(data, null, 2)
);

    const game =
      data?.game ||
      data?.contests?.[0] ||
      data?.games?.[0]?.game ||
      data;

    const rawLinescores =
      game?.linescores ||
      data?.linescores ||
      [];

    const linescores = Array.isArray(rawLinescores)
      ? rawLinescores.map((ls) => ({
          period: ls.period?.toString() || "",
          home: ls.home?.toString() || "",
          visit: ls.visit?.toString() || "",
        }))
      : [];

    return {
      linescores,
      venue: game?.venue || game?.site || game?.facility || "",
      city: game?.city || "",
      state: game?.state || "",
      attendance: game?.attendance?.toString() || "",
      network: game?.network || game?.tv || game?.broadcast || "",
    };
  } catch {
    return { linescores: [], venue: "", city: "", state: "", attendance: "", network: "" };
  }
}

const PLAYOFF_WEEKS = [16, 17, 18, 19, 20];

export async function fetchPlayoffScoreboard(
  baseParams: Omit<NewScoreboardParams, "week">
) {
  const responses = await Promise.all(
    PLAYOFF_WEEKS.map((week) => fetchGqlScoreboard({ ...baseParams, week }))
  );

  const allContests = responses.flatMap(
    (response) => response?.data?.contests || []
  );

  return {
    data: {
      contests: allContests,
    },
  };
}

export async function convertToOldFormat(
  newData: GraphQLResponse,
  sport: string,
  division: string,
  date: string,
  year: number
) {
  const normalizeGameState = (gameState: string): string => {
    switch (gameState) {
      case "F":
        return "final";
      case "P":
        return "pre";
      case "I":
        return "live";
      default:
        return "pre";
    }
  };

  let oldFormatData: OldFormatData | null = null;

  if (
    year < 2025 &&
    !sport.startsWith("basket") &&
    !sport.startsWith("football")
  ) {
    try {
      const oldUrl = `https://data.ncaa.com/casablanca/scoreboard/${sport}/${division}/${date}/scoreboard.json`;
      const oldResponse = await fetch(oldUrl);

      if (oldResponse.ok) {
        oldFormatData = await oldResponse.json();
      } else {
        console.log(`Old endpoint returned status: ${oldResponse.status}`);
      }
    } catch (err) {
      console.log("Could not fetch old format data:", err);
    }
  }

  const contests = newData?.data?.contests || [];

  const games = await Promise.all(
    contests.map(async (contest: Contest) => {
      const teams = contest.teams || [];
      const homeTeam = teams.find((team: Team) => team.isHome);
      const awayTeam = teams.find((team: Team) => !team.isHome);

      if (!homeTeam || !awayTeam) return null;

      const findMatchingGame = (team1Name: string, team2Name: string) => {
        if (!oldFormatData?.games) return null;

        return oldFormatData.games.find((game: OldFormatGame) => {
          const homeShort = game.game?.home?.names?.short?.toLowerCase();
          const awayShort = game.game?.away?.names?.short?.toLowerCase();
          const team1Lower = team1Name.toLowerCase();
          const team2Lower = team2Name.toLowerCase();

          return (
            (homeShort === team1Lower && awayShort === team2Lower) ||
            (homeShort === team2Lower && awayShort === team1Lower)
          );
        });
      };

      const matchingOldGame = findMatchingGame(
        homeTeam.nameShort,
        awayTeam.nameShort
      );

      const formatTeam = (team: Team, isWinner: boolean, isHome: boolean) => {
        let conferenceName = "";
        let fullName = "";
        let description = "";

        if (matchingOldGame?.game) {
          const oldTeamData = isHome
            ? matchingOldGame.game.home
            : matchingOldGame.game.away;

          conferenceName =
            oldTeamData?.conferences?.[0]?.conferenceName || "";
          fullName = oldTeamData?.names?.full || "";
          description = oldTeamData?.description || "";
        }

        return {
          score: team.score?.toString() || "",
          names: {
            char6: team.name6Char || "",
            short: team.nameShort || "",
            seo: team.seoname || "",
            full: fullName,
          },
          winner: isWinner,
          seed: team.seed?.toString() || "",
          description,
          rank: team.teamRank?.toString() || "",
          conferences: [
            {
              conferenceName,
              conferenceSeo: team.conferenceSeo || "",
            },
          ],
        };
      };

      let startTime = contest.startTime || "";

      if (startTime && contest.startDate) {
        const parsedDate = new Date(`${contest.startDate} ${startTime}`);

        if (!Number.isNaN(parsedDate.getTime())) {
          startTime = `${parsedDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })} ET`;
        }
      }

      const gameID = (contest.id || contest.contestId)?.toString() || "";

     const gameDetails = await fetchGameDetails(gameID);

const linescores = contest.linescores?.length
  ? contest.linescores.map((ls) => ({
      period: ls.period?.toString() || "",
      home: ls.home?.toString() || "",
      visit: ls.visit?.toString() || "",
    }))
  : gameDetails.linescores;

const game: Record<string, any> = {
        gameID,
        away: formatTeam(awayTeam, awayTeam.isWinner, false),
        finalMessage: contest.finalMessage || "",
        title: contest.teams
          ? `${awayTeam.nameShort || ""} ${homeTeam.nameShort || ""}`
          : "",
        url: contest.url || "",
        network:
  gameDetails.network ||
  matchingOldGame?.game?.network ||
  contest.broadcasterName ||
  "",

venue: gameDetails.venue,
city: gameDetails.city,
state: gameDetails.state,
attendance: gameDetails.attendance,

home: formatTeam(homeTeam, homeTeam.isWinner, true),
        liveVideoEnabled: (contest.liveVideos || []).length > 0,
        startTime,
        startTimeEpoch: contest.startTimeEpoch?.toString() || "",
        gameState: normalizeGameState(contest.gameState || ""),
        startDate: contest.startDate || "",
        currentPeriod: contest.currentPeriod || "",
        contestClock: contest.contestClock || "0:00",
        linescores,
        bracketId: contest.bracketId || "",
        bracketRound: contest.roundNumber || "",
      };

      if (contest.championshipId) {
        game.championshipId = contest.championshipId;
      }

      if (contest.championshipGame) {
        delete contest.championshipGame.__typename;
        delete contest.championshipGame.round?.__typename;
        game.championshipGame = contest.championshipGame;
      }
if (contest.id?.toString() === gameID) {
  console.log(
    "RAW CONTEST:",
    JSON.stringify(contest, null, 2)
  );
}
      return { game };
    })
  );

  const filteredGames = games.filter(Boolean);

  const gamesString = JSON.stringify(filteredGames);
  const md5Sum = createHash("md5").update(gamesString).digest("hex");

  return {
    inputMD5Sum: md5Sum,
    instanceId: instance_id,
    updated_at: new Date().toISOString().replace("T", " ").substring(0, 19),
    games: filteredGames,
  };
}
