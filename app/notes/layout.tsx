import type { Metadata } from "next";
import { headers } from "next/headers";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";
import { getPublicNotes } from "@/lib/db";
import SidebarLayout from "@/components/sidebar-layout";
import NotesAnalytics from "@/components/notes-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";


export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: siteConfig.title,
  description: siteConfig.title,
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const notes = await getPublicNotes();
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>{siteConfig.title}</title>
        <meta property="twitter:card" content="summary_large_image"></meta>
        <meta property="twitter:title" content={siteConfig.title}></meta>
        <meta property="twitter:description" content={siteConfig.description}></meta>
        <meta property="twitter:image" content={`${siteConfig.url}/og-image.png`}></meta>
        <meta property="og:site_name" content={siteConfig.title}></meta>
        <meta property="og:description" content={siteConfig.description}></meta>
        <meta property="og:title" content={siteConfig.title}></meta>
        <meta property="og:url" content={siteConfig.url}></meta>
        <meta property="og:image" content={`${siteConfig.url}/og-image.png`}></meta>
        <meta property="og:type" content="website"></meta>
      </head>
      <body
        className={cn("min-h-dvh font-sans antialiased")}
      >
        <ThemeProvider
          nonce={nonce}
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <SidebarLayout notes={notes} initialTimestamp={new Date().toISOString()}>
            <NotesAnalytics />
            {children}
          </SidebarLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
