import Link from "next/link";

// Placeholder for surfaces still being condensed (Invocation, Manifest).
export function ComingSoon({
  kicker,
  title,
  line,
}: {
  kicker: string;
  title: string;
  line: string;
}) {
  return (
    <div className="gallery-body">
      <main
        className="gallery-wrap"
        style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}
      >
        <div className="kicker readout mono manifest" style={{ ["--d" as string]: 0, marginBottom: 18 }}>
          <span className="tick" />
          <span>{kicker}</span>
        </div>
        <h1
          className="manifest aberrate"
          style={{ ["--d" as string]: 1, fontFamily: "var(--font-display)", fontWeight: 300, fontSize: 52, letterSpacing: "0.02em" }}
        >
          {title}
        </h1>
        <p className="voice manifest" style={{ ["--d" as string]: 2, marginTop: 16, maxWidth: "42ch", color: "var(--dim)" }}>
          {line}
        </p>
        <Link
          className="ghost-btn cyan manifest"
          style={{ ["--d" as string]: 3, marginTop: 36 }}
          href="/gallery"
        >
          ← Back to the Gallery
        </Link>
      </main>
    </div>
  );
}
