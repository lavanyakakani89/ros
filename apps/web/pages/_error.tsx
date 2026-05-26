import type { NextPageContext } from "next";

interface ErrorPageProps {
  statusCode: number;
}

export default function ErrorPage({ statusCode }: Readonly<ErrorPageProps>) {
  const title = statusCode === 404 ? "Page not found" : "Something went wrong";
  const message = statusCode === 404 ? "The page you are looking for is not available." : "Please reload the page or try again shortly.";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <div style={{ textAlign: "center", padding: "24px" }}>
        <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#047857", textTransform: "uppercase" }}>RetailOS</p>
        <h1 style={{ margin: "12px 0 8px", fontSize: "32px" }}>{title}</h1>
        <p style={{ margin: 0, color: "#64748b" }}>{message}</p>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;

  return { statusCode };
};
