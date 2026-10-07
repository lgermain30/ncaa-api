/*
 * School sites write hometowns in AP style ("Baltimore, Md.", "Dallas, Texas",
 * "Darien, Conn."), lax.com in postal style ("Baltimore, MD"). Everything is
 * shown postal style: "Town, ST" (Canada/overseas keep their country).
 */

const STATES: Record<string, string> = {
	alabama: "AL",
	ala: "AL",
	alaska: "AK",
	arizona: "AZ",
	ariz: "AZ",
	arkansas: "AR",
	ark: "AR",
	california: "CA",
	calif: "CA",
	colorado: "CO",
	colo: "CO",
	connecticut: "CT",
	conn: "CT",
	delaware: "DE",
	del: "DE",
	florida: "FL",
	fla: "FL",
	georgia: "GA",
	ga: "GA",
	hawaii: "HI",
	idaho: "ID",
	illinois: "IL",
	ill: "IL",
	indiana: "IN",
	ind: "IN",
	iowa: "IA",
	kansas: "KS",
	kan: "KS",
	kans: "KS",
	kentucky: "KY",
	ky: "KY",
	louisiana: "LA",
	la: "LA",
	maine: "ME",
	maryland: "MD",
	md: "MD",
	massachusetts: "MA",
	mass: "MA",
	michigan: "MI",
	mich: "MI",
	minnesota: "MN",
	minn: "MN",
	mississippi: "MS",
	miss: "MS",
	missouri: "MO",
	mo: "MO",
	montana: "MT",
	mont: "MT",
	nebraska: "NE",
	neb: "NE",
	nebr: "NE",
	nevada: "NV",
	nev: "NV",
	"new hampshire": "NH",
	nh: "NH",
	"new jersey": "NJ",
	nj: "NJ",
	"new mexico": "NM",
	nm: "NM",
	"new york": "NY",
	ny: "NY",
	"north carolina": "NC",
	nc: "NC",
	"north dakota": "ND",
	nd: "ND",
	ohio: "OH",
	oklahoma: "OK",
	okla: "OK",
	oregon: "OR",
	ore: "OR",
	pennsylvania: "PA",
	pa: "PA",
	penn: "PA",
	"rhode island": "RI",
	ri: "RI",
	"south carolina": "SC",
	sc: "SC",
	"south dakota": "SD",
	sd: "SD",
	tennessee: "TN",
	tenn: "TN",
	texas: "TX",
	tex: "TX",
	utah: "UT",
	vermont: "VT",
	vt: "VT",
	virginia: "VA",
	va: "VA",
	washington: "WA",
	wash: "WA",
	"west virginia": "WV",
	wva: "WV",
	wv: "WV",
	wisconsin: "WI",
	wis: "WI",
	wisc: "WI",
	wyoming: "WY",
	wyo: "WY",
	"district of columbia": "DC",
	dc: "DC",
	"washington dc": "DC",
	"washington, d.c.": "DC",
	// Canadian provinces
	ontario: "ON",
	ont: "ON",
	quebec: "QC",
	que: "QC",
	"british columbia": "BC",
	alberta: "AB",
	alta: "AB",
	manitoba: "MB",
	man: "MB",
	saskatchewan: "SK",
	sask: "SK",
	"nova scotia": "NS",
	"new brunswick": "NB",
	"newfoundland and labrador": "NL",
	newfoundland: "NL",
	"prince edward island": "PE",
	pei: "PE",
};
const POSTAL = new Set(Object.values(STATES));

const key = (s: string) =>
	s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

function titleCase(s: string): string {
	return s
		.toLowerCase()
		.replace(/(^|[\s\-'’.(])([a-z])/g, (_, pre, c) => pre + c.toUpperCase())
		.replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}

/** Re-case a town that arrived ALL CAPS or all lower; leave mixed case alone. */
function town(s: string): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t === t.toUpperCase() || t === t.toLowerCase() ? titleCase(t) : t;
}

export function formatHometown(raw: string | null | undefined): string | null {
	const s = (raw ?? "")
		.replace(/\s+/g, " ")
		.replace(/\s*,\s*/g, ", ")
		.trim();
	if (!s) return null;
	const parts = s.split(", ");
	if (parts.length === 1) return town(s);
	const [first, ...rest] = parts;
	const out = rest.map((p) => {
		const k = key(p);
		if (STATES[k]) return STATES[k];
		if (POSTAL.has(p.toUpperCase()) && p.length <= 3) return p.toUpperCase();
		return town(p);
	});
	return [town(first), ...out].join(", ");
}
