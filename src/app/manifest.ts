import type { MetadataRoute } from "next";

/**
 * The installable-app description offered to the browser.
 *
 * The app bar's "Install App" item asks the browser to fire its install prompt,
 * which only happens when a manifest like this is served and an icon of at least
 * 192px exists. Every field here describes this portal as it actually is: the
 * shortcut opens the recruiter dashboard, and an unauthenticated visit is bounced
 * to the sign-in page by the route guard.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sharm Dreams Talent Cloud",
    short_name: "Talent Cloud",
    description:
      "Recruiter portal for the Sharm Dreams Group — CV screening, assessments, interviews and hiring analytics.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f4f0",
    theme_color: "#161616",
    icons: [
      { src: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      {
        src: "/sdg-icon.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/sdg-icon.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
