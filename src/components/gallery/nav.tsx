import Link from "next/link";
import { signOut } from "@/app/actions";

type Current = "gallery" | "invocation" | "manifest";

// The Manifest is reached from an open brand / the Invocation, not the nav.
const LINKS: { key: Current; href: string; label: React.ReactNode }[] = [
  { key: "gallery", href: "/gallery", label: "Gallery" },
  { key: "invocation", href: "/invocation", label: <>The&nbsp;Invocation</> },
];

export function LabNav({
  invoker,
  current = "gallery",
  status,
}: {
  invoker: string;
  current?: Current;
  status?: React.ReactNode;
}) {
  return (
    <nav className="lab-nav" aria-label="Primary">
      <Link className="sigil" href="/gallery" aria-label="PHANTOM">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path
            d="M4.5 17.5h4.2c-2.4-1.3-4-3.6-4-6.5a6.3 6.3 0 1 1 12.6 0c0 2.9-1.6 5.2-4 6.5h4.2"
            stroke="#DDE3FF"
            strokeOpacity="0.85"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </Link>
      <Link className="wordmark-link" href="/gallery">
        <span className="wordmark-sm">Phantom</span>
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            {...(l.key === current ? { "aria-current": "page" as const } : {})}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="spacer" />
      {status ?? (
        <span className="mono" style={{ fontSize: "9.5px" }}>
          VEIL&nbsp;STATUS&nbsp;·&nbsp;<b>THIN</b>
        </span>
      )}
      <div className="user-chip">
        <span className="orb" />
        invoker:&nbsp;<b>{invoker}</b>
      </div>
      <form action={signOut}>
        <button type="submit" className="signout-btn">
          Dismiss
        </button>
      </form>
    </nav>
  );
}
