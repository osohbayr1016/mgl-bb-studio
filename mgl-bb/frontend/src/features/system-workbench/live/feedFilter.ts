import type { LiveEvent } from './routeMap';

export type FeedFilter = 'all' | 'db' | 'writes' | 'errors' | 'mine';

export const FEED_FILTERS: Array<[FeedFilter, string]> = [
  ['all', 'All'],
  ['db', 'D1'],
  ['writes', 'Writes'],
  ['errors', 'Errors'],
  ['mine', 'Mine'],
];

export function filterFeed(feed: LiveEvent[], f: FeedFilter, me: number | null): LiveEvent[] {
  switch (f) {
    case 'db':
      return feed.filter((e) => e.q > 0);
    case 'writes':
      return feed.filter((e) => e.w > 0);
    case 'errors':
      return feed.filter((e) => e.s >= 400);
    case 'mine':
      return feed.filter((e) => me != null && e.u === me);
    default:
      return feed;
  }
}
