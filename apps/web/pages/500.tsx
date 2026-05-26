export default function Custom500() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <div style={{ textAlign: "center", padding: "24px" }}>
        <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#047857", textTransform: "uppercase" }}>RetailOS</p>
        <h1 style={{ margin: "12px 0 8px", fontSize: "32px" }}>Something went wrong</h1>
        <p style={{ margin: 0, color: "#64748b" }}>Please reload the page or try again shortly.</p>
      </div>
    </main>
  );
}
