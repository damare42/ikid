/**
 * ikid brand — "The Journey" wordmark.
 * The word is set with dotless ı's (Fraunces gradient italic); the two
 * missing i-dots are drawn as waypoints — where you are → where you're
 * going — joined by a dashed route.
 */
export function IkidLogo({ height = 36, className = "" }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="-4 -14 148 96"
      height={height}
      role="img"
      aria-label="ikid"
      className={className}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="ikid-brand-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0e744c" />
          <stop offset="1" stopColor="#1cb474" />
        </linearGradient>
      </defs>

      <text
        x="0"
        y="64"
        fontFamily="'Fraunces', Georgia, serif"
        fontWeight={800}
        fontStyle="italic"
        fontSize="58"
        fill="url(#ikid-brand-grad)"
        textLength="128"
        lengthAdjust="spacingAndGlyphs"
      >
        {"ıkıd"}
      </text>

      {/* journey dots + dashed route */}
      <circle cx="16" cy="13" r="5.5" fill="#0e744c" />
      <circle cx="71" cy="13" r="5.5" fill="#1cb474" />
      <path d="M16,13 C34,-8 53,-8 71,13" fill="none" stroke="#1cb474" strokeWidth="2.5" strokeDasharray="6 6" />
    </svg>
  );
}

/** Compact route glyph — favicon and tight spaces. */
export function IkidMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} role="img" aria-label="ikid mark" style={{ display: "block" }}>
      <circle cx="26" cy="68" r="11" fill="#0e744c" />
      <circle cx="70" cy="30" r="11" fill="#1cb474" />
      <path d="M33,58 C44,38 52,46 62,38" fill="none" stroke="#1cb474" strokeWidth="5" strokeDasharray="8 8" strokeLinecap="round" />
    </svg>
  );
}
