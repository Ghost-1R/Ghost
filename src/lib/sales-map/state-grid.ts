/**
 * Simplified US "tile grid" map: one square per state (+ DC), arranged roughly where the
 * state sits geographically. Deliberately not exact geography — it keeps the SVG tiny,
 * crisp when tilted in CSS 3D, and every state is a large click target.
 */
export type StateTile = { code: string; name: string; col: number; row: number };

export const STATE_GRID_COLUMNS = 11;
export const STATE_GRID_ROWS = 7;

export const STATE_TILES: readonly StateTile[] = [
  { code: "AK", name: "Alaska", col: 0, row: 0 },
  { code: "ME", name: "Maine", col: 10, row: 0 },

  { code: "WA", name: "Washington", col: 1, row: 1 },
  { code: "ID", name: "Idaho", col: 2, row: 1 },
  { code: "MT", name: "Montana", col: 3, row: 1 },
  { code: "ND", name: "North Dakota", col: 4, row: 1 },
  { code: "MN", name: "Minnesota", col: 5, row: 1 },
  { code: "WI", name: "Wisconsin", col: 6, row: 1 },
  { code: "MI", name: "Michigan", col: 7, row: 1 },
  { code: "NY", name: "New York", col: 8, row: 1 },
  { code: "VT", name: "Vermont", col: 9, row: 1 },
  { code: "NH", name: "New Hampshire", col: 10, row: 1 },

  { code: "OR", name: "Oregon", col: 1, row: 2 },
  { code: "NV", name: "Nevada", col: 2, row: 2 },
  { code: "WY", name: "Wyoming", col: 3, row: 2 },
  { code: "SD", name: "South Dakota", col: 4, row: 2 },
  { code: "IA", name: "Iowa", col: 5, row: 2 },
  { code: "IL", name: "Illinois", col: 6, row: 2 },
  { code: "IN", name: "Indiana", col: 7, row: 2 },
  { code: "OH", name: "Ohio", col: 8, row: 2 },
  { code: "PA", name: "Pennsylvania", col: 9, row: 2 },
  { code: "MA", name: "Massachusetts", col: 10, row: 2 },

  { code: "CA", name: "California", col: 1, row: 3 },
  { code: "UT", name: "Utah", col: 2, row: 3 },
  { code: "CO", name: "Colorado", col: 3, row: 3 },
  { code: "NE", name: "Nebraska", col: 4, row: 3 },
  { code: "MO", name: "Missouri", col: 5, row: 3 },
  { code: "KY", name: "Kentucky", col: 6, row: 3 },
  { code: "WV", name: "West Virginia", col: 7, row: 3 },
  { code: "VA", name: "Virginia", col: 8, row: 3 },
  { code: "NJ", name: "New Jersey", col: 9, row: 3 },
  { code: "CT", name: "Connecticut", col: 10, row: 3 },

  { code: "AZ", name: "Arizona", col: 2, row: 4 },
  { code: "NM", name: "New Mexico", col: 3, row: 4 },
  { code: "KS", name: "Kansas", col: 4, row: 4 },
  { code: "AR", name: "Arkansas", col: 5, row: 4 },
  { code: "TN", name: "Tennessee", col: 6, row: 4 },
  { code: "NC", name: "North Carolina", col: 7, row: 4 },
  { code: "MD", name: "Maryland", col: 8, row: 4 },
  { code: "DE", name: "Delaware", col: 9, row: 4 },
  { code: "RI", name: "Rhode Island", col: 10, row: 4 },

  { code: "OK", name: "Oklahoma", col: 4, row: 5 },
  { code: "LA", name: "Louisiana", col: 5, row: 5 },
  { code: "MS", name: "Mississippi", col: 6, row: 5 },
  { code: "AL", name: "Alabama", col: 7, row: 5 },
  { code: "SC", name: "South Carolina", col: 8, row: 5 },
  { code: "DC", name: "District of Columbia", col: 9, row: 5 },

  { code: "HI", name: "Hawaii", col: 0, row: 6 },
  { code: "TX", name: "Texas", col: 4, row: 6 },
  { code: "GA", name: "Georgia", col: 7, row: 6 },
  { code: "FL", name: "Florida", col: 8, row: 6 },
];

export function stateName(code: string): string {
  return STATE_TILES.find((tile) => tile.code === code)?.name ?? code;
}
