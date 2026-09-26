import { Link } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import type { V1Game, V1Team } from '@/lib/types';

function Side({ team, dim }: { team: V1Team; dim: boolean }) {
  const muted = useThemeColor({}, 'muted');
  const name = team.shortName || team.name;
  const displayName = name.length > 18 && team.char6 ? team.char6 : name;
  return (
    <RNView style={styles.side} accessibilityLabel={`${name}${team.record ? `, ${team.record}` : ''}`}>
      <TeamLogo seoName={team.seoName} fallback={team.char6 || name} size={32} />
      <Text style={[styles.name, dim && { color: muted }]} numberOfLines={2}>
        {team.rank ? <Text style={[styles.rank, { color: muted }]}>{team.rank} </Text> : null}
        {displayName}
      </Text>
      {team.record ? <Text style={[styles.record, { color: muted }]}>{team.record}</Text> : null}
    </RNView>
  );
}

/** CHN-style one-line matchup: away | status/score | home, venue underneath. */
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
    <Link href={{ pathname: '/game/[id]', params: { id: game.id } }} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: card, borderBottomColor: border },
          last && { borderBottomWidth: 0 },
          pressed && { opacity: 0.6 },
        ]}>
        <RNView style={styles.main}>
          <Side team={game.away} dim={final && !game.away.isWinner} />
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
          <Side team={game.home} dim={final && !game.home.isWinner} />
        </RNView>
        {sub ? (
          <Text style={[styles.sub, { color: muted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  name: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  rank: { fontSize: 11, fontWeight: '600' },
  record: { fontSize: 11 },
  center: { width: 90, alignItems: 'center', alignSelf: 'center' },
  score: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  time: { fontSize: 15, fontWeight: '700' },
  status: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  sub: { fontSize: 11, textAlign: 'center', marginTop: 4 },
});
