/** Kept out of any component body — calling Date.now() inline in a component fails React's purity lint rule. */
export function daysUntil(isoDate: string): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}
