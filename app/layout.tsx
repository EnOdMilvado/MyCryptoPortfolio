import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { HideBalanceProvider } from "@/components/HideBalanceProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MyCryptoPortfolio",
  description: "Track all your crypto wallets across every network in one place.",
};

// Inline script: pick the saved theme + dark preference from localStorage
// and apply them before paint, so we never flash the default.
const themeBootstrap = `
(function () {
  try {
    var t = localStorage.getItem('crypto-theme');
    var allowed = ['slate','ocean','sunset','forest'];
    if (!t || allowed.indexOf(t) === -1) t = 'slate';
    document.documentElement.classList.add('theme-' + t);
    var d = localStorage.getItem('crypto-dark');
    var dark = d === '1' ? true
             : d === '0' ? false
             : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('theme-slate');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans text-text antialiased">
        {/* Theme bootstrap: runs before paint via next/script + the
            beforeInteractive strategy, replacing a raw <script> tag in
            <head> (Next 16 + React 19 flags raw <script> as an error). */}
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
        <ThemeProvider>
          <HideBalanceProvider>{children}</HideBalanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
