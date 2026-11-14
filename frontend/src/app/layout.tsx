import type { Metadata } from "next";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { appConfig } from "@/config";

const appTitle = `${appConfig.branding.appName} - AI Legal Platform`;

// A profile may supply its own tab icon; otherwise the stock Mike icon set
// (SVG, .ico and raster Apple touch icon) is used unchanged.
const iconSrc = appConfig.branding.iconSrc;
const iconType = iconSrc?.endsWith(".svg") ? "image/svg+xml" : "image/png";
const appIcons: Metadata["icons"] = iconSrc
    ? {
          icon: [{ url: iconSrc, type: iconType }],
          apple:
              appConfig.branding.appleTouchIconSrc ??
              iconSrc,
      }
    : {
          icon: [
              { url: "/icon.svg", type: "image/svg+xml" },
              { url: "/favicon.ico" },
          ],
          apple: "/apple-touch-icon.png",
      };

export const metadata: Metadata = {
    metadataBase: new URL(appConfig.branding.appUrl),
    title: appTitle,
    description: appConfig.branding.tagline,
    icons: appIcons,
    openGraph: {
        type: "website",
        url: appConfig.branding.appUrl,
        siteName: appConfig.branding.appName,
        title: appTitle,
        description: appConfig.branding.tagline,
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 651,
                alt: appConfig.branding.appName,
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: appTitle,
        description: appConfig.branding.tagline,
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" data-profile={appConfig.id}>
            <body
                className="font-sans antialiased"
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
