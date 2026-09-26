import { useEffect, useRef, useState } from 'react';
import EventSource from 'react-native-sse';

import { streamUrl } from '@/lib/api';
import type { Division, GameEvent, GameEventType, Sport } from '@/lib/types';

const EVENT_TYPES: GameEventType[] = [
  'game.new',
  'game.state',
  'game.score',
  'game.clock',
  'game.linescore',
  'game.details',
];

export interface StreamStatus {
  connected: boolean;
  lastEventId: number | null;
  eventCount: number;
}

/**
 * Subscribes to /v1/stream for the given filter and calls `onEvent` for each
 * game event. Reconnects automatically (react-native-sse) and resumes from the
 * last event id so nothing is missed. Pass `enabled=false` to hold the
 * connection closed (e.g. when looking at a past date).
 */
export function useGameStream(
  filter: { sport?: Sport; division?: Division; date?: string; game?: string },
  onEvent: (event: GameEvent) => void,
  enabled = true,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>({
    connected: false,
    lastEventId: null,
    eventCount: 0,
  });
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const lastIdRef = useRef<number | null>(null);
  const url = streamUrl(filter);

  useEffect(() => {
    if (!enabled) {
      setStatus((s) => ({ ...s, connected: false }));
      return;
    }
    const headers: Record<string, string> = {};
    if (lastIdRef.current !== null) headers['Last-Event-ID'] = String(lastIdRef.current);
    const es = new EventSource<GameEventType | 'hello'>(url, { headers, timeout: 60_000 });

    es.addEventListener('open', () => setStatus((s) => ({ ...s, connected: true })));
    es.addEventListener('error', () => setStatus((s) => ({ ...s, connected: false })));
    es.addEventListener('close', () => setStatus((s) => ({ ...s, connected: false })));
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        if (!e.data) return;
        try {
          const event = JSON.parse(e.data) as GameEvent;
          lastIdRef.current = event.id;
          setStatus((s) => ({ ...s, lastEventId: event.id, eventCount: s.eventCount + 1 }));
          onEventRef.current(event);
        } catch {
          // ignore malformed frame
        }
      });
    }
    return () => {
      es.removeAllEventListeners();
      es.close();
    };
  }, [url, enabled]);

  return status;
}
