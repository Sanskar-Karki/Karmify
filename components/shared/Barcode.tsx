import { encodeCode128 } from "@/lib/code128";

// Blank margin each side that scanners need to find where the code starts.
const QUIET_ZONE_MODULES = 10;

/**
 * A Code 128 barcode sized in millimetres. The default 0.5 mm bar unit is exactly
 * 4 dots on a 203 dpi label printer, so bars print with clean, even edges.
 */
export function Barcode({ value, moduleMm = 0.5, heightMm = 11 }: { value: string; moduleMm?: number; heightMm?: number }) {
  const encoded = encodeCode128(value);
  if (!encoded) return null;

  const total = encoded.modules + QUIET_ZONE_MODULES * 2;
  const path = encoded.bars.map(bar => `M${bar.x + QUIET_ZONE_MODULES} 0h${bar.width}v1h-${bar.width}z`).join("");

  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      viewBox={`0 0 ${total} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ display: "block", margin: "0 auto", width: `${total * moduleMm}mm`, height: `${heightMm}mm` }}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
