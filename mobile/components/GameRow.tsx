import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import type { V1Game, V1Team } from '@/lib/types';

const LOGO = 34;

/** Team name + rank on top, logo beneath, hugging the outer edge (CHN layout). Tap → team page. */
function Side({ team, game, home }: { team: V1Team; game: V1Game; home: boolean }) {
  const name = team.shortName || team.name;
  const open = () =>
    router.push({
      pathname: '/games/team/[id]',
      params: { id: team.seoName || name, sport: game.sport, division: game.division, seoName: team.seoName ?? '', name },
    });
  return (
    <Pressable
      onPress={open}
      hitSlop={4}
      accessibilityRole="link"
      accessibilityLabel={`${name}${team.record ? `, ${team.record}` : ''}`}
      style={({ pressed }) => [styles.side, home && styles.sideHome, pressed && { opacity: 0.5 }]}>
      <RNView style={[styles.nameLine, home && styles.nameLineHome]}>
        {home && team.rank ? <Text style={styles.rank}>{team.rank} </Text> : null}
        <Text style={[styles.name, home && styles.nameHome]} numberOfLines={1}>
          {name}
        </Text>
        {!home && team.rank ? <Text style={styles.rank}> {team.rank}</Text> : null}
      </RNView>
      <TeamLogo seoName={team.seoName} fallback={team.char6 || name} size={LOGO} />
    </Pressable>
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
  const centerColor = live ? brand.live : state === 'pre' || final ? brand.red : muted;

  return (
    <Link href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: alt ? bg : card, borderBottomColor: border },
          last && { borderBottomWidth: 0 },
          pressed && { opacity: 0.6 },
        ]}>
        <Side team={game.away} game={game} home={false} />
        <RNView style={styles.center}>
          {showScore ? (
            <RNView style={styles.scoreLine}>
              <Text style={[styles.score, { color: centerColor }, final && !game.away.isWinner && { color: muted }]}>
                {game.away.score ?? 0}
              </Text>
              <Text style={[styles.status, { color: centerColor }]} numberOfLines={1}>
                {live ? game.status.display : 'FINAL'}
              </Text>
              <Text style={[styles.score, { color: centerColor }, final && !game.home.isWinner && { color: muted }]}>
                {game.home.score ?? 0}
              </Text>
            </RNView>
          ) : (
            <Text style={[styles.time, { color: centerColor }]} numberOfLines={1}>
              {state === 'pre' ? game.startTime || 'TBA' : game.status.display}
            </Text>
          )}
          {sub ? (
            <Text style={[styles.sub, { color: muted }]} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </RNView>
        <Side team={game.home} game={game} home />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  side: { width: 112, alignItems: 'flex-start', gap: 4 },
  sideHome: { alignItems: 'flex-end' },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', maxWidth: '100%' },
  nameLineHome: { justifyContent: 'flex-end' },
  name: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  nameHome: { textAlign: 'right' },
  rank: { fontSize: 11, fontWeight: '700', color: '#3779be' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 12, paddingHorizontal: 4 },
  time: { fontSize: 17, fontWeight: '800' },
  scoreLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  score: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  status: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  sub: { fontSize: 10, textAlign: 'center', marginTop: 3 },
});
