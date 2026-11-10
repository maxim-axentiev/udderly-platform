import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  fetchNamingLink,
  isAbortError,
  NamingApiError,
  namingErrorMessage,
  submitNamingName,
  type NamingLinkView,
} from "../naming/api";
import { CampaignFrame, JourneyPage } from "../naming/campaign-chrome";
import { Button } from "../naming/button";
import { NamingCertificate } from "../naming/certificate";
import { CAMPAIGN_DEADLINE_NOTE } from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";

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
    <CampaignFrame>
      <JourneyPage
        eyebrow="Name That Thing!"
        title="Name this object"
        printHeading={false}
      >
        <p className="print-hidden text-sm text-body-copy">
          {CAMPAIGN_DEADLINE_NOTE}
        </p>
        <p className="print-hidden">
          <a href="/" className="font-display font-extrabold uppercase text-headline underline">
            All objects
          </a>
        </p>

        {loading ? (
          <p className="print-hidden text-body-copy" role="status">
            Opening naming link…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="print-hidden text-headline">
            {error}
          </p>
        ) : null}

        {link ? (
          <div className="space-y-6">
            <article className="print-hidden chunky-card overflow-hidden rounded-3xl bg-background">
              <ObjectPhoto src={link.photoUrl} name={link.objectName} />
              <div className="space-y-2 p-5">
                <h2 className="font-display text-3xl font-black uppercase text-headline">
                  {link.objectName}
                </h2>
                {link.description ? (
                  <p className="text-body-copy">{link.description}</p>
                ) : null}
              </div>
            </article>

            {link.namingStatus === "named" && !submittedName ? (
              <p className="text-body-copy">This object has already been named.</p>
            ) : submittedName ? (
              <>
                <p className="print-hidden text-body-copy">
                  The submitted name is <strong>{submittedName}</strong>.
                </p>
                <NamingCertificate
                  objectName={link.objectName}
                  description={link.description}
                  photoUrl={link.photoUrl}
                  submittedName={submittedName}
                />
                <Button
                  type="button"
                  className="print-hidden"
                  onClick={() => window.print()}
                >
                  Print / Save as PDF
                </Button>
              </>
            ) : pendingName ? (
              <section aria-live="polite" className="space-y-4">
                <h2 className="font-display text-3xl font-black uppercase text-headline">
                  Confirm this name
                </h2>
                <p>
                  Submit <strong>{pendingName}</strong> for {link.objectName}?
                  Family-friendly names only. Our farm team reviews each one,
                  and a name can be submitted once.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitName()}
                  >
                    {submitting ? "Submitting…" : "Submit name"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => setPendingName(null)}
                  >
                    Edit name
                  </Button>
                </div>
              </section>
            ) : !link.submissionOpen ? (
              <p className="text-headline">
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
                  <label
                    htmlFor="naming-name"
                    className="font-display text-sm font-extrabold uppercase text-headline"
                  >
                    Name
                  </label>
                  <input
                    id="naming-name"
                    value={name}
                    maxLength={40}
                    autoComplete="off"
                    className="mt-2 block w-full rounded-2xl border-2 border-headline bg-background px-3 py-3"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <p className="mt-2 text-sm text-body-copy">
                    {name.length} / 40 characters. Keep it family-friendly. Our
                    farm team reviews each name, and a name can be submitted
                    once.
                  </p>
                </div>
                <Button type="submit">Review name</Button>
              </form>
            )}
          </div>
        ) : null}
      </JourneyPage>
    </CampaignFrame>
  );
}
