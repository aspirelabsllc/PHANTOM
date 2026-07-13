import {
  Cormorant_Garamond,
  Outfit,
  IBM_Plex_Mono,
  Space_Grotesk,
  IBM_Plex_Sans,
} from "next/font/google";

// The voice — Cormorant Garamond. Display serif, carries the wordmark, headings,
// and the Phantom's italic speech.
export const cormorant = Cormorant_Garamond({
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// The instrument — Outfit. Clean grotesque for UI / body.
export const outfit = Outfit({
  weight: ["200", "300", "400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

// The readout — IBM Plex Mono. Laboratory metadata, mono accents.
export const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Specimen faces — surface an extracted brand's own type inside the Invocation.
export const spaceGrotesk = Space_Grotesk({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-specimen-display",
  display: "swap",
});

export const plexSans = IBM_Plex_Sans({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-specimen-body",
  display: "swap",
});
