import { Link } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import type { V1Game, V1Team } from '@/lib/types';

const LOGO = 30;

function TeamName({ team, home }: { team: V1Team; home: boolean }) {
  const name = team.shortName || team.name;
  return (
    <RNView style={[styles.nameWrap, home && styles.nameWrapHome]} accessibilityLabel={`${name}${team.record ? `, ${team.record}` : ''}`}>
      {team.rank ? <Text style={styles.rank}>{team.rank}</Text> : null}
      <Text style={[styles.name, home && styles.nameHome]} numberOfLines={1}>
        {name}
      </Text>
    </RNView>
  );
}

export function GameRow({ game, last, alt }: { game: V1Game; last?: boolean; alt?: boolean }) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const bg = useThemeColor({}, 'background');
  const { state } = game.status;
  const live = state === 'live';
  const final = state === 'final';
  const showScore = live || final;
  const venue = game.venue
    ? [game.venue.name, [game.venue.city, game.venue.state].filter(Boolean).join(', ')].filter(Boolean).join(' - ')
    : '';
  const sub = [venue, game.broadcast.network].filter(Boolean).join(' · ');
  const statusColor = live ? brand.live : final ? brand.red : muted;

  return (
    <Link href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: alt ? bg : card, borderBottomColor: border },
          last && { borderBottomWidth: 0 },
          pressed && { opacity: 0.6 },
        ]}>
        <RNView style={styles.names}>
          <TeamName team={game.away} home={false} />
          <TeamName team={game.home} home />
        </RNView>
        <RNView style={styles.scoreLine}>
          <TeamLogo seoName={game.away.seoName} fallback={game.away.char6 || game.away.name} size={LOGO} />
          <Text style={[styles.score, final && !game.away.isWinner && { color: muted }]}>
            {showScore ? game.away.score ?? 0 : ''}
          </Text>
          <Text style={[styles.status, { color: statusColor }]} numberOfLines={1}>
            {live ? '● ' : ''}
            {showScore ? game.status.display : state === 'pre' ? game.startTime || 'TBA' : game.status.display}
          </Text>
          <Text style={[styles.score, final && !game.home.isWinner && { color: muted }]}>
            {showScore ? game.home.score ?? 0 : ''}
          </Text>
          <TeamLogo seoName={game.home.seoName} fallback={game.home.char6 || game.home.name} size={LOGO} />
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
  row: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  names: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 0 },
  nameWrapHome: { justifyContent: 'flex-end' },
  name: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  nameHome: { textAlign: 'right' },
  rank: { fontSize: 12, fontWeight: '700', color: '#3779be' },
  scoreLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  score: { flex: 1, fontSize: 24, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  status: { width: 110, fontSize: 15, fontWeight: '700', textAlign: 'center', textTransform: 'uppercase' },
  sub: { fontSize: 12, textAlign: 'center', marginTop: 3 },
});
