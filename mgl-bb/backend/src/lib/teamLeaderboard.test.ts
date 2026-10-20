/**
 * `lib/teamLeaderboard.ts` — Багууд хуудасны «Эрэмбэ» таб: багийн дундаж
 * (Бүтээмж табтай ижил Σоноо ÷ Σхүн-өдөр), өмнөх хугацааны өөрчлөлт, эрэмбэ.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { summarizeTeam, rankTeams, changePct } = await import('./teamLeaderboard.ts');

const NONE = new Set<string>();
// 2026-09-21 Даваа … 09-25 Баасан (5 ажлын өдөр), өмнөх 7 хоног 09-14 … 09-18.
const PREV = { from: '2026-09-14', to: '2026-09-20' };
const CUR = { from: '2026-09-21', to: '2026-09-27' };

function pts(entries: Array<[string, number]>) {
  return new Map(entries);
}

describe('summarizeTeam', () => {
  test('багийн дундаж = Σ оноо ÷ Σ хүн-өдөр, чөлөөт өдөр хасагдана', () => {
    const s = summarizeTeam({
      members: [
        { user_id: 1, daily: { joined: null, points: pts([['2026-09-21', 1], ['2026-09-22', 1]]), leave: undefined } },
        // 2 өдөр чөлөөтэй → 3 ажиллах ёстой өдөр
        {
          user_id: 2,
          daily: { joined: null, points: pts([['2026-09-24', 0.5]]), leave: new Set(['2026-09-21', '2026-09-22']) },
        },
      ],
      ranges: [PREV, CUR],
      prevIndex: 0,
      holidays: NONE,
      thresholdPct: 20,
    });
    assert.equal(s.members, 2);
    assert.equal(s.team_points, 2.5);
    assert.equal(s.person_days, 8);
    assert.equal(s.team_avg, 0.3125);
    assert.equal(s.prev_team_avg, 0);
    assert.equal(s.change_pct, null); // өмнөх 0 → харьцангуй өөрчлөлт тодорхойгүй
    assert.equal(s.top_user_id, 1);
    assert.equal(s.series.length, 2);
  });

  test('гишүүнгүй баг — дундаж null', () => {
    const s = summarizeTeam({ members: [], ranges: [PREV, CUR], prevIndex: 0, holidays: NONE, thresholdPct: 20 });
    assert.equal(s.team_avg, null);
    assert.equal(s.team_points, 0);
    assert.equal(s.gap_exceeded, false);
  });
});

describe('changePct', () => {
  test('харьцангуй', () => {
    assert.equal(changePct(0.3, 0.2), 50);
    assert.equal(changePct(0.1, 0.2), -50);
    assert.equal(changePct(null, 0.2), null);
  });
});

describe('rankTeams', () => {
  test('дундажаар буурах, тэнцсэнд ижил байр, дундажгүй нь сүүлд', () => {
    const r = rankTeams([
      { id: 1, code: 'A', team_avg: 0.1, team_points: 1 },
      { id: 2, code: 'B', team_avg: null, team_points: 0 },
      { id: 3, code: 'C', team_avg: 0.3, team_points: 3 },
      { id: 4, code: 'D', team_avg: 0.1, team_points: 1 },
    ]);
    assert.deepEqual(
      r.map((x) => [x.code, x.rank]),
      [
        ['C', 1],
        ['A', 2],
        ['D', 2],
        ['B', null],
      ],
    );
  });
});
