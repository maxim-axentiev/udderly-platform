import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  fetchReservation,
  isAbortError,
  namingErrorMessage,
  type ReservationView,
} from "../naming/api";
import { readCheckout, type StoredCheckout } from "../naming/checkout";
import { loadFareharborCheckoutAllowList } from "../naming/fareharbor-checkout";
import {
  CAMPAIGN_DEADLINE_NOTE,
  formatCatalogPrice,
  formatTimestamp,
  holdRemainingLabel,
  reservationStatusText,
} from "../naming/format";
import { CampaignFrame, JourneyPage } from "../naming/campaign-chrome";
import { Button } from "../naming/button";
import { ObjectPhoto } from "../naming/object-photo";

export const Route = createFileRoute("/reservation/$id")({
  loader: () => loadFareharborCheckoutAllowList(),
  head: () => ({
    meta: [{ title: "Reservation · Udderly Ridiculous" }],
  }),
  component: ReservationPage,
});

function ReservationPage() {
  const { id } = Route.useParams();
  const checkoutAllowList = Route.useLoaderData();
  const [reservation, setReservation] = useState<ReservationView | null>(null);
  const [checkout, setCheckout] = useState<StoredCheckout | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCheckout(readCheckout(id, checkoutAllowList));
  }, [id, checkoutAllowList]);

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

  const status = reservation
    ? reservationStatusText(reservation.status, reservation.submittedName)
    : null;

  return (
    <CampaignFrame>
      <JourneyPage eyebrow="Name That Thing!" title="Reservation">
        <p className="text-sm text-body-copy">{CAMPAIGN_DEADLINE_NOTE}</p>
        <p>
          <a href="/" className="font-display font-extrabold uppercase text-headline underline">
            All objects
          </a>
        </p>

        {loading ? (
          <p className="text-body-copy" role="status">
            Checking reservation…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-headline">
            {error}
          </p>
        ) : null}

        {reservation && status ? (
          <div className="space-y-6">
            <article className="chunky-card overflow-hidden rounded-3xl bg-background">
              <ObjectPhoto
                src={reservation.object.photoUrl}
                name={reservation.object.name}
              />
              <div className="space-y-2 p-5">
                <h2 className="font-display text-3xl font-black uppercase text-headline">
                  {reservation.object.name}
                </h2>
                {reservation.object.description ? (
                  <p className="text-body-copy">
                    {reservation.object.description}
                  </p>
                ) : null}
                <p className="font-display text-xl font-extrabold text-primary-accent">
                  {formatCatalogPrice(reservation.object.priceCents)}{" "}
                  gift card
                </p>
              </div>
            </article>

            <section aria-live="polite" className="space-y-3">
              <h2 className="font-display text-3xl font-black uppercase text-headline">
                {status.heading}
              </h2>
              <p className="text-body-copy">{status.detail}</p>
              {reservation.status === "awaiting_payment" &&
              reservation.holdExpiresAt ? (
                <>
                  <p>Hold ends {formatTimestamp(reservation.holdExpiresAt)}</p>
                  <p className="text-body-copy">
                    {holdRemainingLabel(reservation.holdExpiresAt)}
                  </p>
                </>
              ) : null}
              {reservation.status === "awaiting_payment" && checkout ? (
                <p>
                  <Button asChild>
                    <a
                      href={checkout.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Continue to checkout
                    </a>
                  </Button>
                </p>
              ) : null}
              {reservation.status === "awaiting_payment" && !checkout ? (
                <p className="text-body-copy">
                  The checkout link is kept in the browser tab that created
                  this reservation.
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </JourneyPage>
    </CampaignFrame>
  );
}
