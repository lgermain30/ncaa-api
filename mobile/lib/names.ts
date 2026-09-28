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
