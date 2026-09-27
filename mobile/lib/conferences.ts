import { API_BASE } from './api';

export interface ConferenceInfo {
  /** Logo file slug under /conference-logos (matches cln-teams assets). */
  slug: string;
  name: string;
  color: string;
}

/**
 * Conference registry. `aliases` are every spelling the NCAA, lax.com and our own
 * game feed use for the same league; matching is case/punctuation-insensitive and
 * ignores a trailing "conference"/"league".
 */
interface Def extends ConferenceInfo {
  file: string;
  aliases: string[];
}

const DEFS: Def[] = [
  { slug: 'acc', file: 'acc.svg', name: 'ACC', color: '#013ca6', aliases: ['atlantic coast'] },
  { slug: 'america-east', file: 'america-east.svg', name: 'America East', color: '#00457c', aliases: [] },
  { slug: 'american', file: 'american.svg', name: 'American', color: '#c41230', aliases: ['american athletic', 'the american'] },
  { slug: 'asun', file: 'asun.png', name: 'ASUN', color: '#1c3f94', aliases: ['atlantic sun'] },
  { slug: 'atlantic-10', file: 'atlantic-10.svg', name: 'Atlantic 10', color: '#b01c2e', aliases: ['a10', 'a-10'] },
  { slug: 'big-12', file: 'big-12.svg', name: 'Big 12', color: '#c8102e', aliases: [] },
  { slug: 'big-east', file: 'big-east.svg', name: 'Big East', color: '#0033a0', aliases: [] },
  { slug: 'big-south', file: 'big-south.svg', name: 'Big South', color: '#004b8d', aliases: [] },
  { slug: 'big-ten', file: 'big-ten.svg', name: 'Big Ten', color: '#0088ce', aliases: ['big 10', 'b1g'] },
  { slug: 'caa', file: 'caa.svg', name: 'CAA', color: '#002b5c', aliases: ['colonial athletic', 'colonial'] },
  { slug: 'ivy-league', file: 'ivy-league.svg', name: 'Ivy League', color: '#00563f', aliases: ['ivy'] },
  { slug: 'maac', file: '', name: 'MAAC', color: '#00305b', aliases: ['metro atlantic', 'metro atlantic athletic'] },
  { slug: 'mac', file: 'mac.svg', name: 'MAC', color: '#5b2c83', aliases: ['mid-american'] },
  { slug: 'nec', file: 'nec.svg', name: 'NEC', color: '#c8102e', aliases: ['northeast'] },
  { slug: 'patriot', file: 'patriot.svg', name: 'Patriot League', color: '#8b1e3f', aliases: ['patriot'] },
  // D2
  { slug: 'cacc', file: 'cacc.svg', name: 'CACC', color: '#1e3a8a', aliases: ['central atlantic collegiate'] },
  { slug: 'conference-carolinas', file: 'conference-carolinas.svg', name: 'Conference Carolinas', color: '#005a9c', aliases: ['carolinas'] },
  { slug: 'ecc', file: 'ecc.png', name: 'ECC', color: '#0b3d91', aliases: ['east coast'] },
  { slug: 'g-mac', file: 'g-mac.png', name: 'G-MAC', color: '#a6192e', aliases: ['great midwest', 'great midwest athletic'] },
  { slug: 'gliac', file: 'gliac.svg', name: 'GLIAC', color: '#0e4c92', aliases: [] },
  { slug: 'glvc', file: 'glvc.svg', name: 'GLVC', color: '#1f4e79', aliases: ['great lakes valley'] },
  { slug: 'gulf-south', file: 'gulf-south.svg', name: 'Gulf South', color: '#0c2340', aliases: [] },
  { slug: 'mec', file: 'mec.svg', name: 'MEC', color: '#1b365d', aliases: ['mountain east'] },
  { slug: 'ne10', file: 'ne10.svg', name: 'NE10', color: '#003087', aliases: ['northeast-10', 'northeast 10'] },
  { slug: 'pac', file: 'pac.png', name: 'PAC', color: '#7a1f2b', aliases: ['presidents', "presidents' athletic", 'presidents athletic'] },
  { slug: 'peach-belt', file: 'peach-belt.svg', name: 'Peach Belt', color: '#e87722', aliases: [] },
  { slug: 'psac', file: 'psac.svg', name: 'PSAC', color: '#8a1538', aliases: ['pennsylvania state athletic'] },
  { slug: 'rmac', file: 'rmac.svg', name: 'RMAC', color: '#005f83', aliases: ['rocky mountain athletic'] },
  { slug: 'sac', file: 'sac.svg', name: 'SAC', color: '#0a3161', aliases: ['south atlantic'] },
  { slug: 'sunshine-state', file: 'sunshine-state.svg', name: 'Sunshine State', color: '#f2a900', aliases: ['ssc'] },
  // D3
  { slug: 'amcc', file: 'amcc.png', name: 'AMCC', color: '#2f4f8f', aliases: ['allegheny mountain', 'allegheny mountain cc', 'allegheny mountain collegiate'] },
  { slug: 'atlantic-east', file: 'atlantic-east.svg', name: 'Atlantic East', color: '#1d3557', aliases: [] },
  { slug: 'c2c', file: '', name: 'Coast to Coast', color: '#0f6e8c', aliases: ['coast to coast', 'coast-to-coast'] },
  { slug: 'cciw', file: 'cciw.svg', name: 'CCIW', color: '#8c2131', aliases: ['of illinois-wisc', 'illinois-wisconsin', 'illinois wisconsin'] },
  { slug: 'centennial', file: 'centennial.png', name: 'Centennial', color: '#1a3e6e', aliases: [] },
  { slug: 'clc', file: '', name: 'Coastal Lacrosse', color: '#0b6e99', aliases: ['coastal lacrosse'] },
  { slug: 'commonwealth-coast', file: '', name: 'Commonwealth Coast', color: '#003f6b', aliases: ['ccc', 'cne', 'new england cc'] },
  { slug: 'csac', file: '', name: 'CSAC', color: '#5c2d91', aliases: ['colonial states athletic', 'colonial states'] },
  { slug: 'empire-8', file: 'empire-8.png', name: 'Empire 8', color: '#003366', aliases: ['empire eight'] },
  { slug: 'great-northeast', file: 'great-northeast.png', name: 'GNAC', color: '#004c97', aliases: ['gnac', 'great northeast athletic'] },
  { slug: 'hcac', file: 'hcac.svg', name: 'HCAC', color: '#8d1b3d', aliases: ['heartland collegiate athletic', 'heartland athletic', 'heartland'] },
  { slug: 'landmark', file: 'landmark.svg', name: 'Landmark', color: '#0a4a7a', aliases: [] },
  { slug: 'liberty-league', file: 'liberty-league.svg', name: 'Liberty League', color: '#1c2b5a', aliases: ['liberty'] },
  { slug: 'little-east', file: 'little-east.svg', name: 'Little East', color: '#0f4c81', aliases: ['lec'] },
  { slug: 'mac-commonwealth', file: 'mac-commonwealth.png', name: 'MAC Commonwealth', color: '#6a1b3a', aliases: ['mac-commonwealth'] },
  { slug: 'mac-freedom', file: 'mac-freedom.png', name: 'MAC Freedom', color: '#1f3a93', aliases: ['mac-freedom'] },
  { slug: 'mascac', file: 'mascac.png', name: 'MASCAC', color: '#123f6d', aliases: [] },
  { slug: 'michigan-intercol-ath-assn', file: 'michigan-intercol-ath-assn.png', name: 'MIAA', color: '#1b4d3e', aliases: ['miaa', 'michigan intercol. ath. assn.', 'michigan intercollegiate athletic'] },
  { slug: 'midwest', file: '', name: 'Midwest', color: '#3d5a80', aliases: ["midwest women's lacrosse", 'midwest lacrosse', 'mwlc'] },
  { slug: 'nacc', file: 'nacc.png', name: 'NACC', color: '#0b5394', aliases: ['northern athletics collegiate', 'northern athletics'] },
  { slug: 'ncac', file: 'ncac.png', name: 'NCAC', color: '#b22234', aliases: ['north coast athletic', 'north coast'] },
  { slug: 'neac', file: '', name: 'NEAC', color: '#2a4d69', aliases: ['north eastern athletic'] },
  { slug: 'nescac', file: 'nescac.png', name: 'NESCAC', color: '#0c2340', aliases: ['new england small college athletic'] },
  { slug: 'newmac', file: 'newmac.png', name: 'NEWMAC', color: '#005eb8', aliases: ['new england ma', "new england women's and men's athletic"] },
  { slug: 'njac', file: 'njac.svg', name: 'NJAC', color: '#c8102e', aliases: ['new jersey athletic'] },
  { slug: 'north-atlantic', file: 'north-atlantic.png', name: 'North Atlantic', color: '#006747', aliases: ['nac'] },
  { slug: 'nwc', file: 'nwc.jpg', name: 'Northwest', color: '#00573f', aliases: ['northwest'] },
  { slug: 'oac', file: 'oac.png', name: 'OAC', color: '#a6192e', aliases: ['ohio athletic'] },
  { slug: 'odac', file: 'odac.png', name: 'ODAC', color: '#002d62', aliases: ['old dominion athletic', 'old dominion'] },
  { slug: 'saa', file: 'saa.png', name: 'SAA', color: '#1d4e89', aliases: ['southern athletic association', 'southern athletic'] },
  { slug: 'sciac', file: 'sciac.png', name: 'SCIAC', color: '#f47c30', aliases: ['southern california intercollegiate athletic'] },
  { slug: 'skyline', file: 'skyline.jpg', name: 'Skyline', color: '#0072ce', aliases: [] },
  { slug: 'sunyac', file: 'sunyac.png', name: 'SUNYAC', color: '#0033a0', aliases: ['suny athletic', 'state university of new york athletic'] },
  { slug: 'united-east', file: 'united-east.png', name: 'United East', color: '#1b2a49', aliases: [] },
  { slug: 'usa-south', file: 'usa-south.png', name: 'USA South', color: '#0b3c5d', aliases: ['usa south athletic'] },
  { slug: 'wiac', file: 'wiac.svg', name: 'WIAC', color: '#c5050c', aliases: ['wisconsin intercollegiate athletic'] },
];

function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(conference|league|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const INDEX = new Map<string, Def>();
for (const d of DEFS) {
  for (const a of [d.slug, d.name, ...d.aliases]) {
    const k = key(a);
    if (k && !INDEX.has(k)) INDEX.set(k, d);
  }
}

/** Look up a conference by any name/slug variant; null when unknown. */
export function conferenceInfo(nameOrSlug: string | null | undefined): ConferenceInfo | null {
  if (!nameOrSlug) return null;
  const d = INDEX.get(key(nameOrSlug));
  return d ? { slug: d.slug, name: d.name, color: d.color } : null;
}

/** Display name for a conference, or the input cleaned up when unknown. */
export function conferenceName(nameOrSlug: string): string {
  return (
    conferenceInfo(nameOrSlug)?.name ??
    nameOrSlug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

/** Self-hosted logo URL, or null when we have none for this conference. */
export function conferenceLogoUrl(nameOrSlug: string | null | undefined): string | null {
  if (!nameOrSlug) return null;
  const d = INDEX.get(key(nameOrSlug));
  return d?.file ? `${API_BASE}/conference-logos/${d.file}` : null;
}
