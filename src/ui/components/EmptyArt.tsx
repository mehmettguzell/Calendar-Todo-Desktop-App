/**
 * The mark an empty screen opens with.
 *
 * Every empty state in the app used to show the same thing: a lucide glyph in
 * a grey disc. Correct, legible, and the visual equivalent of a shrug — the
 * first screen a new account sees and the last one a finished day ends on,
 * both saying nothing in particular.
 *
 * These are drawn instead: one continuous stroke, the same weight as the
 * app's icons, sized for the space rather than dropped into it. They are line
 * art rather than illustration on purpose — a cartoon would date the app in a
 * year and would be the loudest thing on a screen whose whole point is that it
 * is quiet.
 *
 * The stroke takes `currentColor`, so each one lands in whatever the empty
 * state's own colour is and follows the theme with no second copy.
 */
export type EmptyArtKind = "cleared" | "inbox" | "plans" | "notes" | "search";

export function EmptyArt({
  kind,
  size = 88,
}: {
  kind: EmptyArtKind;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 96 96",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "empty-art",
  };

  switch (kind) {
    /* A day with everything crossed off — the tick is the only closed shape,
       so it is the only thing the eye lands on. */
    case "cleared":
      return (
        <svg {...common}>
          <rect x="18" y="22" width="60" height="54" rx="8" />
          <path d="M18 36h60" />
          <path d="M32 22v-8M64 22v-8" />
          <path d="M30 50h14M30 62h22" opacity="0.45" />
          <path d="M52 52l7 7 13-15" strokeWidth="2.4" />
        </svg>
      );

    /* An empty tray: three rules and nothing resting on them. */
    case "inbox":
      return (
        <svg {...common}>
          <path d="M20 34h56v34a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V34z" />
          <path d="M20 34l8-14h40l8 14" />
          <path d="M20 52h16l4 8h16l4-8h16" />
          <path d="M40 26h16" opacity="0.45" />
        </svg>
      );

    /* A flag on an empty hill: somewhere to aim, nothing planted yet. */
    case "plans":
      return (
        <svg {...common}>
          <path d="M34 76V24" />
          <path d="M34 28h30l-7 9 7 9H34" />
          <path d="M16 76h64" opacity="0.45" />
          <circle cx="34" cy="20" r="3" />
        </svg>
      );

    /* A blank page with a folded corner. */
    case "notes":
      return (
        <svg {...common}>
          <path d="M28 18h26l16 16v44a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" />
          <path d="M54 18v16h16" />
          <path d="M34 52h28M34 62h20" opacity="0.45" />
        </svg>
      );

    /* A glass over nothing. */
    case "search":
      return (
        <svg {...common}>
          <circle cx="42" cy="42" r="20" />
          <path d="M57 57l17 17" strokeWidth="2.4" />
          <path d="M34 42h16" opacity="0.45" />
        </svg>
      );
  }
}
