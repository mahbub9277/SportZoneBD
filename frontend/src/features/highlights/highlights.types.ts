export interface Highlight {
  id: string;
  matchId?: string;
  title: string;
  thumbnail?: string | null;
  thumbnailUrl?: string | null;
  duration?: string | null;
  category?: string | null;
  url: string;
  createdAt?: string;
  updatedAt?: string;
  // You might want to add relation to Match here if needed in the UI
  // match?: Match;
}