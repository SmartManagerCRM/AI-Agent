/** One coherent, dependency-free icon set (Feather-style outline paths) shared by the tenant sidebar and header. */
export const NAV_ICON_PATHS = {
  dashboard: "M3 12l9-9 9 9M5 10v10h14V10",
  orders: "M6 2l1.5 4h9L18 2M4 6h16l-1.5 14a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 6zM9 10v6M15 10v6",
  products: "M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m0 10l-8-4V7m8 10V11m-8-4l8 4",
  branches: "M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  businessBrain:
    "M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8V11a3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 16.5V17a3 3 0 0 0 3 3M9 3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3M9 3v18M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8V11a3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 16.5V17a3 3 0 0 1-3 3M15 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3",
  agent:
    "M12 8V4H8M4 12H2M6.34 6.34 4.93 4.93M22 12h-2M17.66 6.34l1.41-1.41M4 20l4-4M20 20l-4-4M8 16h8v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4zM8 16V10a4 4 0 0 1 8 0v6",
  conversations:
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  customers:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  analytics: "M3 3v18h18M7 16l4-6 4 4 5-8",
  marketing: "M3 11l18-7-7 18-2-8-8-3z",
  billing: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7zM2 10h20",
  staff:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  audit: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  search: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  plus: "M12 5v14M5 12h14",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  chevronDown: "M6 9l6 6 6-6",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  check: "M20 6L9 17l-5-5",
  membership: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zM7 15h4M7 11h2M15.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13 16a2.5 2.5 0 0 1 5 0",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
  pause: "M10 4H6v16h4zM18 4h-4v16h4z",
  play: "M6 3l14 9-14 9V3z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M18 6L6 18M6 6l12 12",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  building:
    "M3 21h18M6 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16M9 8h.01M9 12h.01M9 16h.01M12 8h.01M12 12h.01M12 16h.01M14 21v-8h4a1 1 0 0 1 1 1v7",
  crown: "M3 18h18l-1.5-9-4.5 3-3-6-3 6-4.5-3L3 18zM5 21h14",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  models: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6z",
} as const;

export type NavIconKey = keyof typeof NAV_ICON_PATHS;

export function Icon({ path, size = 18, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
