import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#eee",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <h1>DNA OS</h1>
      <nav style={{ display: "flex", gap: 12 }}>
        <Link href="/deadboard" style={{ color: "#22c55e" }}>
          Dead Board
        </Link>
        <Link href="/dashboard" style={{ color: "#22c55e" }}>
          Dashboard
        </Link>
      </nav>
    </main>
  );
}
