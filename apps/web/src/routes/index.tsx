import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  createReservation,
  fetchNamingObjects,
  fetchPreviewCatalog,
  isAbortError,
  namingErrorMessage,
  type NamingObject,
} from "../naming/api";
import { CampaignFrame } from "../naming/campaign-chrome";
import { rememberCheckout } from "../naming/checkout";
import { loadFareharborCheckoutAllowList } from "../naming/fareharbor-checkout";
import { isFareharborCheckoutUrl } from "../naming/format";
import { CampaignHome } from "../naming/home-sections";
import { ObjectCatalog } from "../naming/object-catalog";
import {
  canPurchaseInPreview,
  loadCampaignPreview,
  PREVIEW_BANNER,
} from "../naming/preview";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [preview, checkoutAllowList] = await Promise.all([
      loadCampaignPreview(),
      loadFareharborCheckoutAllowList(),
    ]);
    return { preview, checkoutAllowList };
  },
  head: () => ({
    meta: [{ title: "Name That Thing! · Udderly Ridiculous" }],
  }),
  component: HomePage,
});

function HomePage() {
  const { preview, checkoutAllowList } = Route.useLoaderData();
  const navigate = useNavigate();
  const [objects, setObjects] = useState<NamingObject[] | null>(null);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = preview.enabled
      ? fetchPreviewCatalog(controller.signal)
      : fetchNamingObjects(controller.signal);
    void load
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
            preview.enabled
              ? "The preview catalogue could not be loaded."
              : "This campaign is not available right now.",
          ),
        );
      });
    return () => controller.abort();
  }, [preview.enabled]);

  async function reserve(objectId: string) {
    if (!canPurchaseInPreview(preview.enabled)) {
      return;
    }
    const popup = window.open("", "_blank");
    setPendingId(objectId);
    setError("");
    try {
      const created = await createReservation(objectId);
      if (isFareharborCheckoutUrl(created.checkoutUrl, checkoutAllowList)) {
        rememberCheckout(
          created.reservationId,
          {
            checkoutUrl: created.checkoutUrl,
            holdExpiresAt: created.holdExpiresAt,
          },
          checkoutAllowList,
        );
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
    <CampaignFrame>
      <CampaignHome
        catalog={
          <>
            {preview.enabled ? (
              <p className="mb-6 rounded-2xl border-2 border-headline bg-background px-4 py-3 text-sm text-body-copy">
                {PREVIEW_BANNER}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mb-6 text-headline">
                {error}
              </p>
            ) : null}
            {objects === null ? (
              <p role="status" className="text-body-copy">
                Loading objects…
              </p>
            ) : (
              <ObjectCatalog
                objects={objects}
                purchasingEnabled={canPurchaseInPreview(preview.enabled)}
                pendingId={pendingId}
                onClaim={(objectId) => void reserve(objectId)}
              />
            )}
          </>
        }
      />
    </CampaignFrame>
  );
}
