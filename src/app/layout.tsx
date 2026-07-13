import type { Metadata } from "next";
import { cormorant, outfit, plexMono, spaceGrotesk, plexSans } from "./fonts";
import { Atmosphere } from "@/components/atmosphere";
import "./globals.css";

export const metadata: Metadata = {
  title: "PHANTOM — Every site already exists",
  description: "PHANTOM — every site already exists, perfect and waiting. We only make it visible.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${outfit.variable} ${plexMono.variable} ${spaceGrotesk.variable} ${plexSans.variable} h-full`}
    >
      <body className="min-h-full">
        <Atmosphere />
        {children}
      </body>
    </html>
  );
}
