/// <reference types="node" />
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { applyOfficialExtras, fetchOfficialExtras, fetchStandings } from '../lib/api.ts';

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

test('men’s DI: lax.com is the base, official streak/conference record merged in when sane', async () => {
  const official = [
    { conference: 'ACC', slug: 'acc', logo: '', season: '2026', count: 1, standings: [{
      team: 'Notre Dame', conferenceRecord: '3-1', overallRecord: '13-3', overallPct: '.812',
      home: '', away: '', neutral: '', goalsForAgainst: '', streak: 'L1',
    }] },
    // shifted columns (pct where the record should be) -> ignored
    { conference: 'ASUN', slug: 'asun', logo: '', season: '2026', count: 1, standings: [{
      team: 'Utah', conferenceRecord: '4-1', overallRecord: '.692', overallPct: '4-2',
      home: '', away: '', neutral: '', goalsForAgainst: '', streak: 'x',
    }] },
  ];
  const lax = [
    { conference: { name: 'Atlantic Coast', id: '4' }, conf_leaderboard: [{
      name: 'notre dame', wins: '13', losses: '3', conf_wins: 4, conf_losses: 2, goals_for: '210', goals_against: '143',
    }] },
    { conference: { name: 'Atlantic Sun', id: '102' }, conf_leaderboard: [{
      name: 'utah', wins: '9', losses: '4', conf_wins: 4, conf_losses: 1, goals_for: '150', goals_against: '120',
    }] },
  ];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/official-standings') return Response.json(official);
    assert.equal(path, '/standings/lacrosse-men/d1');
    return Response.json(JSON.stringify(lax));
  };
  const base = await fetchStandings('lacrosse-men', 'd1', '2026');
  assert.equal(base[0].standings[0].conferenceRecord, '4-2');
  assert.equal(base[0].standings[0].streak, '');
  const [acc, asun] = applyOfficialExtras(base, await fetchOfficialExtras('2026'));
  assert.equal(acc.conference, 'Atlantic Coast');
  assert.deepEqual(acc.standings[0], {
    team: 'Notre Dame', conferenceRecord: '3-1', overallRecord: '13-3', overallPct: '',
    home: '', away: '', neutral: '', goalsForAgainst: '210-143', streak: 'L1',
  });
  assert.equal(asun.standings[0].conferenceRecord, '4-1');
  assert.equal(asun.standings[0].goalsForAgainst, '150-120');
  assert.equal(asun.standings[0].streak, '');
});

test('men’s DI still loads when official standings are unavailable', async () => {
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/official-standings') return new Response('nope', { status: 502 });
    return Response.json(JSON.stringify([{ conference: { name: 'Big 10', id: '69' }, conf_leaderboard: [{
      name: 'penn state', wins: '10', losses: '6', conf_wins: 5, conf_losses: 2,
    }] }]));
  };
  const base = await fetchStandings('lacrosse-men', 'd1', '2026');
  const [big] = applyOfficialExtras(base, await fetchOfficialExtras('2026'));
  assert.equal(big.standings[0].team, 'Penn State');
  assert.equal(big.standings[0].streak, '');
});
