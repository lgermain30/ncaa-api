import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { todayEt } from '@/lib/api';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Cells for a month grid: leading nulls for the offset, then 1..N. */
function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array<null>(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function CalendarSheet({
  visible,
  date,
  gameDays,
  onSelect,
  onMonthChange,
  onClose,
}: {
  visible: boolean;
  /** Currently selected YYYY-MM-DD. */
  date: string;
  /** YYYY-MM-DD → number of games; days absent have no games. */
  gameDays: Record<string, number>;
  onSelect: (date: string) => void;
  /** Called with the visible year so callers can load that year's game days. */
  onMonthChange?: (year: number) => void;
  onClose: () => void;
}) {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const tint = useThemeColor({}, 'tint');
  const bg = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');

  const [view, setView] = useState(() => ({ year: +date.slice(0, 4), month: +date.slice(5, 7) - 1 }));
  const cells = useMemo(() => monthCells(view.year, view.month), [view]);
  const today = todayEt();

  const shift = (n: number) => {
    const d = new Date(Date.UTC(view.year, view.month + n, 1));
    const next = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    setView(next);
    if (next.year !== view.year) onMonthChange?.(next.year);
  };

  const gameDates = useMemo(() => Object.keys(gameDays).sort(), [gameDays]);
  const latest = useMemo(() => {
    for (let i = gameDates.length - 1; i >= 0; i--) if (gameDates[i] <= today) return gameDates[i];
    return null;
  }, [gameDates, today]);
  const next = useMemo(() => gameDates.find((d) => d > today) ?? null, [gameDates, today]);

  const jump = (d: string) => {
    setView({ year: +d.slice(0, 4), month: +d.slice(5, 7) - 1 });
    onSelect(d);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: card, borderColor: border }]} onPress={() => {}}>
          <RNView style={styles.head}>
            <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityLabel="Previous month">
              <Text style={[styles.arrow, { color: tint }]}>‹</Text>
            </Pressable>
            <Text style={styles.title}>
              {MONTHS[view.month]} {view.year}
            </Text>
            <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityLabel="Next month">
              <Text style={[styles.arrow, { color: tint }]}>›</Text>
            </Pressable>
          </RNView>

          <RNView style={styles.grid}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={[styles.cell, styles.weekday, { color: muted }]}>
                {w}
              </Text>
            ))}
            {cells.map((day, i) => {
              if (!day) return <RNView key={i} style={styles.cell} />;
              const d = ymd(view.year, view.month, day);
              const count = gameDays[d];
              const selected = d === date;
              const isToday = d === today;
              return (
                <Pressable
                  key={i}
                  onPress={() => jump(d)}
                  style={[styles.cell, selected && { backgroundColor: tint, borderRadius: 18 }]}
                  accessibilityLabel={`${d}${count ? `, ${count} games` : ''}`}>
                  <Text
                    style={[
                      styles.dayNum,
                      { color: selected ? bg : count ? text : muted },
                      isToday && !selected && { color: brand.red, fontWeight: '800' },
                    ]}>
                    {day}
                  </Text>
                  <RNView style={[styles.dot, { backgroundColor: count ? (selected ? bg : brand.red) : 'transparent' }]} />
                </Pressable>
              );
            })}
          </RNView>

          <RNView style={[styles.actions, { borderTopColor: border }]}>
            <Pressable onPress={() => jump(today)} style={styles.action}>
              <Text style={[styles.actionText, { color: tint }]}>Today</Text>
            </Pressable>
            <Pressable onPress={() => latest && jump(latest)} style={styles.action} disabled={!latest}>
              <Text style={[styles.actionText, { color: latest ? tint : muted }]}>Latest games</Text>
            </Pressable>
            <Pressable onPress={() => next && jump(next)} style={styles.action} disabled={!next}>
              <Text style={[styles.actionText, { color: next ? tint : muted }]}>Next games</Text>
            </Pressable>
          </RNView>
          <Text style={[styles.legend, { color: muted }]}>● game day</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '700' },
  arrow: { fontSize: 30, lineHeight: 32, paddingHorizontal: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekday: { height: 24, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  dayNum: { fontSize: 15, fontWeight: '500' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, paddingTop: 8 },
  action: { paddingVertical: 8, paddingHorizontal: 6 },
  actionText: { fontSize: 15, fontWeight: '600' },
  legend: { fontSize: 11, textAlign: 'center', marginTop: 4 },
});
