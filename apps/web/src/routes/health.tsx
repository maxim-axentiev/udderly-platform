import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/health")({
  component: HealthPage,
});

type HealthPayload = {
  status?: string;
};

function HealthPage() {
  const [apiHealth, setApiHealth] = useState<string>("checking");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

    void fetch(`${apiUrl}/health`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as HealthPayload;
      })
      .then((payload) => {
        setApiHealth(payload.status ?? "unknown");
        setDetail("");
      })
      .catch((error: unknown) => {
        setApiHealth("unreachable");
        setDetail(error instanceof Error ? error.message : "Unknown error");
      });
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Platform status</h1>
      <p className="mt-3 text-stone-600">Frontend is running.</p>
      <p className="mt-2 text-stone-600">API health: {apiHealth}</p>
      {detail ? <p className="mt-2 text-sm text-stone-500">{detail}</p> : null}
      <p className="mt-8">
        <Link to="/" className="text-stone-800 underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
