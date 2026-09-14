import { Link, createFileRoute } from "@tanstack/react-router";
import { PLATFORM_DESCRIPTION, PLATFORM_NAME } from "@udderly/shared";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{PLATFORM_NAME}</h1>
      <p className="mt-3 text-stone-600">{PLATFORM_DESCRIPTION}</p>
      <p className="mt-8">
        <Link to="/health" className="text-stone-800 underline">
          Platform status
        </Link>
      </p>
    </main>
  );
}
