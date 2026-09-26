import { Redirect, useLocalSearchParams } from 'expo-router';

export default function OldGameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/games/[id]', params: { id } }} />;
}
