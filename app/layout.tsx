import type { Metadata, Viewport } from "next";
import "./globals.css";
import { EyLogo } from "@/components/ui/EyLogo";
import { MegaNav } from "@/components/ui/MegaNav";
import { Assistant } from "@/components/Assistant";

export const metadata: Metadata = {
  title: "EY TMT Intelligence",
  description:
    "Technology, media and telecom intelligence. Sector signal, reported results, KPI detail and on-demand company research.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1a1a24",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>

        <header className="banner">
          <div className="banner-inner">
            <a href="/" aria-label="EY TMT Intelligence, home" className="banner-brand">
              <EyLogo height={30} />
            </a>
            <span className="banner-divider" aria-hidden="true" />
            <span className="banner-title">TMT Intelligence</span>
            <MegaNav />
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="shell site-foot">
          <hr className="rule-strong" />
          <div className="foot-grid">
            <p className="foot-note">
              Figures are drawn from regulatory filings, company documents and
              licensed market data, each labelled with its source and the time it
              was retrieved. Analysis here is provided for information. It is not
              investment advice, and it is not a recommendation to buy or sell
              anything. Please take your own advice before acting on it.
            </p>
            <nav className="foot-links" aria-label="Footer">
              <a className="foot-link" href="/terms">Terms and sources</a>
              <a
                className="foot-link"
                href="https://www.sec.gov/edgar"
                target="_blank"
                rel="noopener noreferrer"
              >
                SEC EDGAR
              </a>
            </nav>
          </div>
          <div className="foot-credit">
            <span className="foot-by">
              Developed by{" "}
              <a
                href="https://jewellabs.io"
                target="_blank"
                rel="noopener noreferrer"
              >
                Jewel Labs
              </a>
            </span>
            <span className="foot-by">EY TMT Intelligence</span>
          </div>
        </footer>

        <Assistant />
      </body>
    </html>
  );
}
