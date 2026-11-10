import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  fetchReservation,
  isAbortError,
  namingErrorMessage,
  type ReservationView,
} from "../naming/api";
import { readCheckout, type StoredCheckout } from "../naming/checkout";
import {
  CAMPAIGN_DEADLINE_NOTE,
  formatPrice,
  formatTimestamp,
  holdRemainingLabel,
  reservationStatusText,
} from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";
import { CampaignShell } from "../naming/shell";

export const Route = createFileRoute("/reservation/$id")({
  head: () => ({
    meta: [{ title: "Reservation · Udderly Ridiculous" }],
  }),
  component: ReservationPage,
});

function ReservationPage() {
  const { id } = Route.useParams();
  const [reservation, setReservation] = useState<ReservationView | null>(null);
  const [checkout, setCheckout] = useState<StoredCheckout | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCheckout(readCheckout(id));
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchReservation(id, controller.signal)
      .then((next) => {
        setReservation(next);
        setError("");
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) {
          return;
        }
        setReservation(null);
        setError(
          namingErrorMessage(caught, "This reservation could not be found."),
        );
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (reservation?.status !== "awaiting_payment") {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchReservation(id)
        .then((next) => {
          setReservation(next);
          setError("");
        })
        .catch((caught: unknown) => {
          setError(
            namingErrorMessage(
              caught,
              "This reservation could not be found.",
            ),
          );
        });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [id, reservation?.status]);

  async function checkStatus() {
    try {
      const next = await fetchReservation(id);
      setReservation(next);
      setError("");
    } catch (caught: unknown) {
      setError(
        namingErrorMessage(caught, "This reservation could not be found."),
      );
    }
  }

  const status = reservation
    ? reservationStatusText(reservation.status, reservation.submittedName)
    : null;

  return (
    <CampaignShell>
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-stone-500">
          <Link to="/" className="underline">
            All objects
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Reservation
        </h1>
        <p className="mt-4 text-sm text-stone-700">{CAMPAIGN_DEADLINE_NOTE}</p>

        {loading ? (
          <p className="mt-6 text-stone-600" role="status">
            Checking reservation…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-6 text-stone-800">
            {error}
          </p>
        ) : null}

        {reservation && status ? (
          <div className="mt-6 space-y-6">
            <article className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <ObjectPhoto
                src={reservation.object.photoUrl}
                name={reservation.object.name}
              />
              <div className="space-y-2 p-5">
                <h2 className="text-xl font-semibold">
                  {reservation.object.name}
                </h2>
                {reservation.object.description ? (
                  <p className="text-stone-600">
                    {reservation.object.description}
                  </p>
                ) : null}
                <p>
                  {formatPrice(
                    reservation.object.priceCents,
                    reservation.object.currency,
                  )}{" "}
                  gift card
                </p>
              </div>
            </article>

            <section aria-live="polite" className="space-y-3">
              <h2 className="text-xl font-semibold">{status.heading}</h2>
              <p className="text-stone-700">{status.detail}</p>
              {reservation.status === "awaiting_payment" &&
              reservation.holdExpiresAt ? (
                <>
                  <p>Hold ends {formatTimestamp(reservation.holdExpiresAt)}</p>
                  <p className="text-stone-600">
                    {holdRemainingLabel(reservation.holdExpiresAt)}
                  </p>
                </>
              ) : null}
              {reservation.status === "awaiting_payment" && checkout ? (
                <p>
                  <a
                    href={checkout.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded bg-stone-900 px-4 py-2 text-white"
                  >
                    Continue to FareHarbor checkout
                  </a>
                </p>
              ) : null}
              {reservation.status === "awaiting_payment" && !checkout ? (
                <p className="text-stone-600">
                  The checkout link is kept in the browser tab that created
                  this reservation.
                </p>
              ) : null}
              <button
                type="button"
                className="rounded border border-stone-300 bg-white px-4 py-2"
                onClick={() => void checkStatus()}
              >
                Check payment status
              </button>
            </section>
          </div>
        ) : null}
      </main>
    </CampaignShell>
  );
}
