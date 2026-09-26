// CLN brand, sampled from the logo: navy lettering, red "N"/"News".
export const brand = {
  navy: '#14365c',
  red: '#ff0a2c',
  gold: '#c9a227',
  live: '#d7263d',
  win: '#1b7f3b',
};

export default {
  light: {
    text: '#0b1320',
    muted: '#6b7280',
    background: '#f4f5f7',
    card: '#ffffff',
    border: '#e5e7eb',
    tint: brand.navy,
    tabIconDefault: '#9ca3af',
    tabIconSelected: brand.navy,
  },
  dark: {
    text: '#f3f4f6',
    muted: '#9ca3af',
    background: '#0b1320',
    card: '#16213a',
    border: '#243352',
    tint: '#8fb3e6',
    tabIconDefault: '#6b7280',
    tabIconSelected: '#8fb3e6',
  },
};
