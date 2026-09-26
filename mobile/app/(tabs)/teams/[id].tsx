import { useLocalSearchParams } from 'expo-router';

import { TeamScreen } from '@/components/TeamScreen';
import type { Division, Sport } from '@/lib/types';

export default function TeamRoute() {
  const p = useLocalSearchParams<{ id: string; sport: Sport; division: Division; seoName?: string; name?: string }>();
  return (
    <TeamScreen
      id={p.id}
      sport={p.sport ?? 'lacrosse-men'}
      division={p.division ?? 'd1'}
      seoName={p.seoName || undefined}
      name={p.name || undefined}
      teamPath="/teams/[id]"
    />
  );
}
