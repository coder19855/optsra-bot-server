export type MarketNewsFeedId = 'google' | 'cnbc';

export interface MarketNewsFeedOption {
  id: MarketNewsFeedId;
  label: string;
  description: string;
  url: string;
  headerSubtitle: string;
  linkHint: string;
}