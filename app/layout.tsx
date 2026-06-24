import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DNA OS — Dead Board",
  description: "Command-driven liquidity & logistics OS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
