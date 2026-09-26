/// <reference types="node" />
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { fetchStandings } from '../lib/api.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('loads and normalizes lacrosse standings for other sports and divisions', async () => {
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    paths.push(String(input));
    return Response.json(JSON.stringify([{
      conference: { name: 'America East', id: '81' },
      conf_leaderboard: [{
        name: 'north carolina', wins: '12', losses: '6', conf_wins: 7, conf_losses: 1,
      }],
    }]));
  };

  for (const [sport, division] of [
    ['lacrosse-women', 'd1'],
    ['lacrosse-men', 'd2'],
    ['lacrosse-men', 'd3'],
  ] as const) {
    const [conference] = await fetchStandings(sport, division, '2026');
    assert.equal(conference.conference, 'America East');
    assert.equal(conference.standings[0].team, 'North Carolina');
    assert.equal(conference.standings[0].conferenceRecord, '7-1');
    assert.equal(conference.standings[0].overallRecord, '12-6');
  }
  assert.deepEqual(paths.map((path) => new URL(path).pathname), [
    '/standings/lacrosse-women/d1',
    '/standings/lacrosse-men/d2',
    '/standings/lacrosse-men/d3',
  ]);
  assert.ok(paths.every((path) => new URL(path).searchParams.get('season') === '2026'));
});

test('retains official standings for men’s DI', async () => {
  const standings = [{
    conference: 'ACC', slug: 'acc', logo: '', season: '2026', count: 1,
    standings: [{
      team: 'Notre Dame', conferenceRecord: '3-1', overallRecord: '13-3',
      overallPct: '.812', home: '6-0', away: '4-1', neutral: '3-2',
      goalsForAgainst: '210-143', streak: 'L1',
    }],
  }];
  globalThis.fetch = async (input) => {
    assert.equal(new URL(String(input)).pathname, '/official-standings');
    return Response.json(standings);
  };
  assert.deepEqual(await fetchStandings('lacrosse-men', 'd1', '2026'), standings);
});
