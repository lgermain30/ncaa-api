import { useEffect, useState } from 'react';

import { kv } from './kv';

export type TextSize = 'normal' | 'large' | 'xlarge';

export const TEXT_SIZE_OPTIONS: { label: string; value: TextSize; scale: number }[] = [
  { label: 'Normal', value: 'normal', scale: 1 },
  { label: 'Large', value: 'large', scale: 1.15 },
  { label: 'Extra Large', value: 'xlarge', scale: 1.3 },
];

export const textScale = (size: TextSize) => TEXT_SIZE_OPTIONS.find((o) => o.value === size)?.scale ?? 1;

export interface Settings {
  boldColors: boolean;
  textSize: TextSize;
  inAppGoalAlerts: boolean;
  watchedGoals: boolean;
  watchedFinal: boolean;
  favoriteGoals: boolean;
  favoriteFinal: boolean;
  /** Minutes before a favorite's game to remind; null = off. */
  favoriteReminderMin: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  boldColors: false,
  textSize: 'normal',
  inAppGoalAlerts: true,
  watchedGoals: false,
  watchedFinal: false,
  favoriteGoals: false,
  favoriteFinal: false,
  favoriteReminderMin: null,
};

export const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
  { label: '2 hrs', value: 120 },
  { label: '1 day', value: 1440 },
];

const KEY = 'cln.settings.v1';

function load(): Settings {
  try {
    const raw = kv.get(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let state = load();
const listeners = new Set<(s: Settings) => void>();

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    kv.set(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: keep in memory only
  }
  for (const l of listeners) l(state);
}

export const resetSettings = () => updateSettings(DEFAULT_SETTINGS);

export function useSettings(): Settings {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
