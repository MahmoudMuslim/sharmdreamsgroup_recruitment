import type { Metadata, Viewport } from "next";
import { Inter, Montserrat, Amiri } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${montserrat.variable} ${amiri.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-brand-ivory text-brand-ink">{children}</body>
    </html>
  );
}