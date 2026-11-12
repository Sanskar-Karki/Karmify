"use client";

import { useEffect } from "react";

// Last resort for a failure in the root layout, so styles and providers can't
// be assumed to exist here.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center", padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Karmify couldn&apos;t load</h1>
          <p style={{ color: "#666", fontSize: 14 }}>Your saved data is safe. Please try again in a moment.</p>
          <button
            onClick={() => unstable_retry()}
            style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: "#CB2957", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
