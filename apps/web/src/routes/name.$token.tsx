import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  fetchNamingLink,
  isAbortError,
  NamingApiError,
  namingErrorMessage,
  submitNamingName,
  type NamingLinkView,
} from "../naming/api";
import { NamingCertificate } from "../naming/certificate";
import { CAMPAIGN_DEADLINE_NOTE } from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";
import { CampaignShell } from "../naming/shell";

export const Route = createFileRoute("/name/$token")({
  head: () => ({
    meta: [{ title: "Name an object · Udderly Ridiculous" }],
  }),
  component: NamingPage,
});

function NamingPage() {
  const { token } = Route.useParams();
  const [link, setLink] = useState<NamingLinkView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchNamingLink(token, controller.signal)
      .then((next) => {
        setLink(next);
        setError("");
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) {
          return;
        }
        setLink(null);
        setError(namingErrorMessage(caught, "This naming link is not valid."));
        setLoading(false);
      });
    return () => controller.abort();
  }, [token]);

  function reviewName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    setError("");
    setPendingName(trimmed);
  }

  async function submitName() {
    if (!pendingName) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitNamingName(token, pendingName);
      setLink((current) =>
        current
          ? {
              ...current,
              namingStatus: "named",
              submittedName: result.submittedName,
            }
          : current,
      );
      setPendingName(null);
    } catch (caught: unknown) {
      if (
        caught instanceof NamingApiError &&
        caught.status === 409 &&
        caught.message === "This item already has a name."
      ) {
        try {
          setLink(await fetchNamingLink(token));
          setPendingName(null);
        } catch {
          setError("This item already has a name.");
        }
      } else {
        setError(namingErrorMessage(caught, "This naming link is not valid."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const submittedName =
    link?.namingStatus === "named" ? link.submittedName : null;

  return (
    <CampaignShell>
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="print-hidden text-sm text-stone-500">
          <Link to="/" className="underline">
            All objects
          </Link>
        </p>
        <h1 className="print-hidden mt-4 text-3xl font-semibold tracking-tight">
          Name this object
        </h1>
        <p className="print-hidden mt-4 text-sm text-stone-700">
          {CAMPAIGN_DEADLINE_NOTE}
        </p>

        {loading ? (
          <p className="print-hidden mt-6 text-stone-600" role="status">
            Opening naming link…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="print-hidden mt-6 text-stone-800">
            {error}
          </p>
        ) : null}

        {link ? (
          <div className="mt-6 space-y-6">
            <article className="print-hidden overflow-hidden rounded-lg border border-stone-200 bg-white">
              <ObjectPhoto src={link.photoUrl} name={link.objectName} />
              <div className="space-y-2 p-5">
                <h2 className="text-xl font-semibold">{link.objectName}</h2>
                {link.description ? (
                  <p className="text-stone-600">{link.description}</p>
                ) : null}
              </div>
            </article>

            {link.namingStatus === "named" && !submittedName ? (
              <p className="text-stone-700">This object has already been named.</p>
            ) : submittedName ? (
              <>
                <p className="print-hidden text-stone-700">
                  The submitted name is <strong>{submittedName}</strong>.
                </p>
                <NamingCertificate
                  objectName={link.objectName}
                  description={link.description}
                  photoUrl={link.photoUrl}
                  submittedName={submittedName}
                />
                <button
                  type="button"
                  className="print-hidden rounded bg-stone-900 px-4 py-2 text-white"
                  onClick={() => window.print()}
                >
                  Print / Save as PDF
                </button>
              </>
            ) : pendingName ? (
              <section aria-live="polite" className="space-y-4">
                <h2 className="text-xl font-semibold">Confirm this name</h2>
                <p>
                  Submit <strong>{pendingName}</strong> for {link.objectName}?
                  A name can be submitted once.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-60"
                    disabled={submitting}
                    onClick={() => void submitName()}
                  >
                    {submitting ? "Submitting…" : "Submit name"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-stone-300 bg-white px-4 py-2"
                    disabled={submitting}
                    onClick={() => setPendingName(null)}
                  >
                    Edit name
                  </button>
                </div>
              </section>
            ) : !link.submissionOpen ? (
              <p className="text-stone-800">
                Names can no longer be submitted. The deadline was January 14,
                2027 at 11:59 p.m. Eastern Time.
              </p>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  reviewName();
                }}
              >
                <div>
                  <label htmlFor="naming-name" className="font-medium">
                    Name
                  </label>
                  <input
                    id="naming-name"
                    value={name}
                    maxLength={40}
                    autoComplete="off"
                    className="mt-2 block w-full rounded border border-stone-300 bg-white px-3 py-2"
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="rounded bg-stone-900 px-4 py-2 text-white"
                >
                  Review name
                </button>
              </form>
            )}
          </div>
        ) : null}
      </main>
    </CampaignShell>
  );
}
