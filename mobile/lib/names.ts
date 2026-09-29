const ACRONYMS: Record<string, string> = {
  njit: 'NJIT', umbc: 'UMBC', umass: 'UMass', liu: 'LIU', vmi: 'VMI', iupui: 'IUPUI', suny: 'SUNY',
  rpi: 'RPI', mit: 'MIT', rit: 'RIT', wpi: 'WPI', tcnj: 'TCNJ', uc: 'UC', usc: 'USC', ucla: 'UCLA',
  unc: 'UNC', smu: 'SMU', byu: 'BYU', nyu: 'NYU', cuny: 'CUNY', upenn: 'UPenn', lsu: 'LSU', uconn: 'UConn',
  umd: 'UMD', unh: 'UNH', uri: 'URI', uva: 'UVA', usf: 'USF', fdu: 'FDU', pfw: 'PFW', vcu: 'VCU', ncaa: 'NCAA',
  depaul: 'DePaul', desales: 'DeSales', lemoyne: 'Le Moyne', mcdaniel: 'McDaniel', mckendree: 'McKendree',
};

/** Title-case lax.com's lowercase school names: "anderson (sc)" -> "Anderson (SC)", "umbc" -> "UMBC". */
export function schoolName(name: string): string {
  return name
    .split(/(\s+|-|\()/)
    .map((w) => {
      const key = w.toLowerCase();
      if (ACRONYMS[key]) return ACRONYMS[key];
      return /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join('')
    .replace(/\(([a-z]{2})\)/gi, (_, s: string) => `(${s.toUpperCase()})`)
    .replace(/\bSt\b\.?/g, 'St.');
}

/** Title-case an all-lowercase person name ("michael sowers" -> "Michael Sowers", "brennan o'neill" -> "Brennan O'Neill"). Mixed-case input is returned unchanged. */
export function personName(name: string | null | undefined): string {
  if (!name) return '';
  if (/[A-Z]/.test(name)) return name;
  return name
    .replace(/(^|[\s\-'’.])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, ch: string) => `Mc${ch.toUpperCase()}`)
    .replace(/\b(Ii|Iii|Iv|Jp|Cj|Tj|Aj|Jj|Dj|Rj|Jt)\b/g, (m) => m.toUpperCase());
}
