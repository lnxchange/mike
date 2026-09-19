import type { Metadata } from "next";
import { Inter, EB_Garamond } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { appConfig } from "@/config";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
    variable: "--font-eb-garamond",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

const appTitle = `${appConfig.branding.appName} - AI Legal Platform`;

// A profile may supply its own tab icon; otherwise the stock Mike icon set
// (SVG, .ico and raster Apple touch icon) is used unchanged.
const appIcons: Metadata["icons"] = appConfig.branding.iconSrc
    ? {
          icon: [{ url: appConfig.branding.iconSrc, type: "image/svg+xml" }],
          apple:
              appConfig.branding.appleTouchIconSrc ??
              appConfig.branding.iconSrc,
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
                className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
