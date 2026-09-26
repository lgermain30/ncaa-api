import { Link } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import type { V1Game, V1Team } from '@/lib/types';

function Side({ team, dim, home }: { team: V1Team; dim: boolean; home: boolean }) {
  const muted = useThemeColor({}, 'muted');
  const name = team.shortName || team.name;
  return (
    <RNView style={[styles.side, home && styles.home]} accessibilityLabel={`${name}${team.record ? `, ${team.record}` : ''}`}>
      <RNView style={[styles.teamLine, home && styles.homeLine]}>
        {home && team.rank ? <Text style={styles.rank}>{team.rank}</Text> : null}
        <Text style={[styles.name, home && styles.homeName, dim && { color: muted }]} numberOfLines={2}>
          {name}
        </Text>
        {!home && team.rank ? <Text style={styles.rank}>{team.rank}</Text> : null}
      </RNView>
      <TeamLogo seoName={team.seoName} fallback={team.char6 || name} size={38} />
    </RNView>
  );
}

export function GameRow({ game, last }: { game: V1Game; last?: boolean }) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const { state } = game.status;
  const live = state === 'live';
  const final = state === 'final';
  const showScore = live || final;
  const venue = game.venue
    ? [game.venue.name, [game.venue.city, game.venue.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    : '';
  const sub = [venue, game.broadcast.network].filter(Boolean).join(' · ');

  return (
    <Link href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: card, borderBottomColor: border },
          last && { borderBottomWidth: 0 },
          pressed && { opacity: 0.6 },
        ]}>
        <RNView style={styles.main}>
          <Side team={game.away} dim={final && !game.away.isWinner} home={false} />
          <RNView style={styles.center}>
            {showScore ? (
              <Text style={styles.score}>
                <Text style={final && !game.away.isWinner ? { color: muted } : undefined}>{game.away.score ?? 0}</Text>
                {'  –  '}
                <Text style={final && !game.home.isWinner ? { color: muted } : undefined}>{game.home.score ?? 0}</Text>
              </Text>
            ) : (
              <Text style={[styles.time, { color: brand.red }]}>{game.startTime || 'TBA'}</Text>
            )}
            <Text style={[styles.status, { color: live ? brand.live : muted }]} numberOfLines={1}>
              {live ? '● ' : ''}
              {showScore ? game.status.display : state === 'pre' ? '' : game.status.display}
            </Text>
          </RNView>
          <Side team={game.home} dim={final && !game.home.isWinner} home />
        </RNView>
        {sub ? (
          <Text style={[styles.sub, { color: muted }]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 68 },
  side: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 8 },
  home: { alignItems: 'flex-end' },
  teamLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4, minHeight: 38 },
  homeLine: { justifyContent: 'flex-end' },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  homeName: { textAlign: 'right' },
  rank: { fontSize: 12, fontWeight: '700', color: '#3779be' },
  center: { width: 82, alignItems: 'center', alignSelf: 'center' },
  score: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  time: { fontSize: 16, fontWeight: '700' },
  status: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  sub: { fontSize: 12, textAlign: 'center', marginTop: 4 },
});
