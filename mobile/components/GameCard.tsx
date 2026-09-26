import { Link } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import type { V1Game, V1Team } from '@/lib/types';

function TeamRow({ team, state }: { team: V1Team; state: V1Game['status']['state'] }) {
  const muted = useThemeColor({}, 'muted');
  const final = state === 'final';
  const dim = final && !team.isWinner;
  return (
    <RNView style={styles.teamRow}>
      <RNView style={styles.teamName}>
        {team.rank ? <Text style={[styles.rank, { color: muted }]}>{team.rank}</Text> : null}
        <Text style={[styles.name, dim && { color: muted }]} numberOfLines={1}>
          {team.shortName || team.name}
        </Text>
        {team.record ? <Text style={[styles.record, { color: muted }]}>{team.record}</Text> : null}
      </RNView>
      <Text style={[styles.score, dim && { color: muted }]}>
        {team.score ?? (state === 'pre' ? '' : '–')}
      </Text>
    </RNView>
  );
}

export function GameCard({ game }: { game: V1Game }) {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const live = game.status.state === 'live';
  const statusColor = live ? brand.live : muted;
  const subline = [game.venue?.name, game.broadcast.network].filter(Boolean).join(' · ');

  return (
    <Link href={{ pathname: '/game/[id]', params: { id: game.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.card, { backgroundColor: card, borderColor: border }, pressed && { opacity: 0.7 }]}>
        <RNView style={styles.header}>
          <Text style={[styles.status, { color: statusColor }]}>
            {live ? '● ' : ''}
            {game.status.display}
          </Text>
        </RNView>
        <TeamRow team={game.away} state={game.status.state} />
        <TeamRow team={game.home} state={game.status.state} />
        {subline ? (
          <Text style={[styles.subline, { color: muted }]} numberOfLines={1}>
            {subline}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
    gap: 6,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  status: { fontSize: 13, fontWeight: '600' },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamName: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flex: 1 },
  rank: { fontSize: 12, fontWeight: '600' },
  name: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  record: { fontSize: 12 },
  score: { fontSize: 20, fontWeight: '700', minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  subline: { fontSize: 12, marginTop: 2 },
});
