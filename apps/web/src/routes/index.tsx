import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  createReservation,
  fetchNamingObjects,
  isAbortError,
  namingErrorMessage,
  type NamingObject,
} from "../naming/api";
import { rememberCheckout } from "../naming/checkout";
import {
  availabilityLabel,
  CAMPAIGN_DEADLINE_NOTE,
  filterByPrice,
  formatPrice,
  isFareharborCheckoutUrl,
  priceChoices,
} from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";
import { loadCampaignPreview } from "../naming/preview";
import { CampaignShell } from "../naming/shell";

export const Route = createFileRoute("/")({
  loader: () => loadCampaignPreview(),
  head: () => ({
    meta: [{ title: "Name a farm object · Udderly Ridiculous" }],
  }),
  component: HomePage,
});

function HomePage() {
  const preview = Route.useLoaderData();
  const navigate = useNavigate();
  const [objects, setObjects] = useState<NamingObject[] | null>(
    preview.enabled ? preview.objects : null,
  );
  const [error, setError] = useState("");
  const [priceFilter, setPriceFilter] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (preview.enabled) {
      return;
    }
    const controller = new AbortController();
    void fetchNamingObjects(controller.signal)
      .then((next) => {
        setObjects(next);
        setError("");
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) {
          return;
        }
        setObjects([]);
        setError(
          namingErrorMessage(
            caught,
            "This campaign is not available right now.",
          ),
        );
      });
    return () => controller.abort();
  }, [preview.enabled]);

  const prices = priceChoices(objects ?? []);
  const activeFilter =
    priceFilter !== null && prices.includes(priceFilter) ? priceFilter : null;
  const visible = filterByPrice(objects ?? [], activeFilter);

  async function reserve(objectId: string) {
    const popup = window.open("", "_blank");
    setPendingId(objectId);
    setError("");
    try {
      const created = await createReservation(objectId);
      if (isFareharborCheckoutUrl(created.checkoutUrl)) {
        rememberCheckout(created.reservationId, {
          checkoutUrl: created.checkoutUrl,
          holdExpiresAt: created.holdExpiresAt,
        });
        if (popup) {
          try {
            popup.opener = null;
            popup.location.replace(created.checkoutUrl);
          } catch {
            popup.close();
          }
        }
      } else {
        popup?.close();
      }
      await navigate({
        to: "/reservation/$id",
        params: { id: created.reservationId },
      });
    } catch (caught: unknown) {
      popup?.close();
      setError(namingErrorMessage(caught, "This object is not available."));
      setPendingId(null);
    }
  }

  return (
    <CampaignShell>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Name something on the farm
        </h1>
        <p className="mt-4 max-w-2xl text-stone-600">
          Pick something on the farm and give it a name. Buy a gift card for
          the price shown, and we will send a private link so you can submit
          one name.
        </p>
        <p className="mt-4 max-w-2xl text-sm text-stone-700">
          {CAMPAIGN_DEADLINE_NOTE}
        </p>
        {preview.enabled ? (
          <p className="mt-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            This is a private preview. These are sample objects, not the
            farm&apos;s real list, and buying is turned off.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-6 text-stone-800">
            {error}
          </p>
        ) : null}

        {objects === null ? (
          <p className="mt-8 text-stone-600" role="status">
            Loading objects…
          </p>
        ) : null}

        {objects && objects.length > 0 ? (
          <div className="mt-8">
            <label htmlFor="price-filter" className="text-sm font-medium">
              Filter by price
            </label>
            <select
              id="price-filter"
              className="mt-2 block rounded border border-stone-300 bg-white px-3 py-2"
              value={activeFilter === null ? "all" : String(activeFilter)}
              onChange={(event) => {
                const value = event.target.value;
                setPriceFilter(value === "all" ? null : Number(value));
              }}
            >
              <option value="all">All prices</option>
              {prices.map((price) => (
                <option key={price} value={price}>
                  {formatPrice(price, objects[0]?.currency ?? "CAD")}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {objects && objects.length === 0 && !error ? (
          <p className="mt-8 text-stone-600">No objects are published yet.</p>
        ) : null}

        {objects && objects.length > 0 && visible.length === 0 ? (
          <p className="mt-8 text-stone-600">No objects at that price.</p>
        ) : null}

        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((object) => (
            <li key={object.id}>
              <article
                aria-labelledby={`object-${object.id}`}
                className="overflow-hidden rounded-lg border border-stone-200 bg-white"
              >
                <ObjectPhoto
                  src={object.photoUrl}
                  name={object.name}
                  emptyLabel={preview.enabled ? "Photo coming soon" : undefined}
                />
                <div className="space-y-3 p-5">
                  {preview.enabled ? (
                    <p className="w-fit rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-950">
                      Sample
                    </p>
                  ) : null}
                  <h2
                    id={`object-${object.id}`}
                    className="text-xl font-semibold tracking-tight"
                  >
                    {object.name}
                  </h2>
                  {object.description ? (
                    <p className="text-stone-600">{object.description}</p>
                  ) : null}
                  <p className="font-medium">
                    {formatPrice(object.priceCents, object.currency)}
                    <span className="ml-2 text-sm font-normal text-stone-600">
                      gift card
                    </span>
                  </p>
                  <p className="text-sm text-stone-700">
                    {availabilityLabel(object.availability)}
                  </p>
                  {object.availability === "available" && preview.enabled ? (
                    <button
                      type="button"
                      className="rounded bg-stone-900 px-4 py-2 text-white opacity-60"
                      disabled
                    >
                      Buy & Name
                    </button>
                  ) : null}
                  {object.availability === "available" && !preview.enabled ? (
                    <button
                      type="button"
                      className="rounded bg-stone-900 px-4 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
                      disabled={pendingId !== null}
                      onClick={() => void reserve(object.id)}
                    >
                      {pendingId === object.id ? "Reserving…" : "Buy & Name"}
                    </button>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </main>
    </CampaignShell>
  );
}
