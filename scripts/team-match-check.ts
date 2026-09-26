/* Dev check: how many NCAA team names on sample game days resolve to a lax.com team. */
import {
	type Division,
	getTeams,
	lookupTeam,
	type Sport,
} from "../src/v1/teams";

const API = "https://ncaa-api-production-1586.up.railway.app";
const DATES = [
	"2026-02-14",
	"2026-02-21",
	"2026-03-07",
	"2026-03-21",
	"2026-04-11",
	"2026-04-25",
];

for (const sport of ["lacrosse-men", "lacrosse-women"] as Sport[]) {
	for (const division of ["d1", "d2", "d3"] as Division[]) {
		const seen = new Map<string, string>();
		for (const d of DATES) {
			const res = await fetch(`${API}/v1/games/${sport}/${division}/${d}`);
			const { data } = (await res.json()) as {
				data: {
					home: { seoName: string; name: string };
					away: { seoName: string; name: string };
				}[];
			};
			for (const g of data)
				for (const t of [g.home, g.away]) seen.set(t.seoName, t.name);
		}
		const lax = (await getTeams(sport, division)).data;
		const misses: string[] = [];
		for (const [seo, name] of seen) {
			const id =
				(await lookupTeam(sport, division, seo)) ??
				(await lookupTeam(sport, division, name));
			if (!id) misses.push(`${seo} (${name})`);
			else if (
				id.replace(/-(w|m|women)$/, "").replace(/[^a-z]/g, "") !==
				seo.replace(/[^a-z]/g, "")
			)
				console.log(`  ~ ${seo} -> ${id}`);
		}
		console.log(
			`${sport}/${division}: ${seen.size} NCAA teams, ${lax.length} lax teams, ${misses.length} unmatched`,
		);
		if (misses.length) console.log(`  ${misses.join(", ")}`);
	}
}
