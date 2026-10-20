import type { Metadata, Viewport } from "next";
import { Inter, Montserrat, Amiri } from "next/font/google";
import { themeBootstrap } from "@/lib/theme";
import { loadTranslationOverrides } from "@/modules/i18n/application/translationOverrides";
import { TranslationsSeed } from "@/modules/i18n/presentation/TranslationsSeed";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

// Amiri is not a variable font — Next.js requires an explicit weight.
const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Sharm Dreams Talent Cloud",
    template: "%s · Sharm Dreams Talent Cloud",
  },
  description:
    "AI-driven HRMS, ATS and skill assessment platform for the Sharm Dreams Group — CV screening, interactive assessments, and real-time hiring analytics.",
  applicationName: "Sharm Dreams Talent Cloud",
};

export const viewport: Viewport = {
  themeColor: "#161616",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read here rather than in each public layout, because wording an admin saved
  // has to reach every surface the same way — including the candidate portal,
  // whose own files this console does not edit. The read is cached and tagged, so
  // it costs one shared query rather than one per route, and a save evicts it.
  const overrides = await loadTranslationOverrides();

  return (
    // `data-palette` and `data-tone` are the theme the CSS ships with; the inline
    // script in <head> may already have replaced both before React hydrates,
    // which is why this element opts out of the attribute check. Reading the
    // preference on the server instead would make the whole tree request-bound
    // and cost the public pages their prerender.
    <html
      lang="en"
      data-palette="base"
      data-tone="light"
      suppressHydrationWarning
      className={`${inter.variable} ${montserrat.variable} ${amiri.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full bg-brand-ivory text-brand-ink">
        {/* First in the body so the wording is in place before any child, server
            or client, calls `translate` during this render. */}
        <TranslationsSeed value={overrides} />
        {children}
      </body>
    </html>
  );
}