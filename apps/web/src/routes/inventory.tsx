import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { formatPrice, formatTimestamp } from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";
import {
  centsToDollars,
  customerObjectCount,
  dollarsToCents,
  filterStaffObjects,
  inventoryPhotoSrc,
  inventoryRequest,
  outstandingNamingCount,
  STAFF_STATUS_FILTERS,
  STAFF_TIER_FILTERS,
  staffAttentionLabel,
  staffCanPublish,
  staffStateLabel,
  type InventoryObject,
  type StaffNamingState,
  type StaffNamingView,
  type StaffStatusFilter,
  type StaffTierFilter,
} from "../naming/inventory";

type NamingRecord = {
  objectId: string;
  objectName: string;
  priceCents: number;
  submittedName: string | null;
  namedAt: string | null;
  resendStatus: "sending" | "sent" | "failed" | null;
  resendCount: number;
  revisions: Array<{
    previousName: string;
    correctedName: string;
    createdAt: string;
  }>;
};

export const Route = createFileRoute("/inventory")({
  component: InventoryPage,
  head: () => ({
    meta: [{ title: "Inventory · Udderly Ridiculous" }],
  }),
});

const PHOTO_LIMIT = 3 * 1024 * 1024;

function InventoryPage() {
  const [password, setPassword] = useState("");
  const [csrfToken, setCsrfToken] = useState<string>();
  const [objects, setObjects] = useState<InventoryObject[] | null>(null);
  const [editing, setEditing] = useState<InventoryObject | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dollars, setDollars] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkedSession, setCheckedSession] = useState(false);
  const [naming, setNaming] = useState<NamingRecord | null>(null);
  const [correction, setCorrection] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<StaffTierFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void inventoryRequest<{ csrfToken: string }>("/inventory/session", undefined)
      .then(async (session) => {
        const body = await inventoryRequest<{ objects: InventoryObject[] }>(
          "/inventory/objects",
          session.csrfToken,
        );
        if (cancelled) {
          return;
        }
        setCsrfToken(session.csrfToken);
        setObjects(body.objects);
      })
      .catch(() => {
        if (!cancelled) {
          setCsrfToken(undefined);
          setObjects(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckedSession(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const session = await inventoryRequest<{ csrfToken: string }>(
        "/inventory/session",
        undefined,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      setCsrfToken(session.csrfToken);
      setPassword("");
      await loadObjects(session.csrfToken);
    } catch (error) {
      setMessage(errorText(error, "That password was not accepted."));
    } finally {
      setBusy(false);
    }
  }

  async function loadObjects(token = csrfToken) {
    const body = await inventoryRequest<{ objects: InventoryObject[] }>(
      "/inventory/objects",
      token,
    );
    setObjects(body.objects);
  }

  async function loadNaming(objectId: string) {
    if (!csrfToken) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const record = await inventoryRequest<NamingRecord>(
        `/inventory/objects/${objectId}/naming`,
        csrfToken,
      );
      setNaming(record);
      setCorrection(record.submittedName ?? "");
    } catch (error) {
      setMessage(errorText(error, "The naming record could not be loaded."));
    } finally {
      setBusy(false);
    }
  }

  async function saveCorrection(objectId: string) {
    if (!csrfToken) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await inventoryRequest(
        `/inventory/objects/${objectId}/naming/correction`,
        csrfToken,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: correction }),
        },
      );
      await loadNaming(objectId);
      await loadObjects();
      setMessage("The corrected name is saved.");
    } catch (error) {
      setMessage(errorText(error, "The name could not be corrected."));
    } finally {
      setBusy(false);
    }
  }

  async function resendCertificate(objectId: string) {
    if (!csrfToken || !window.confirm("Resend the updated certificate link?")) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await inventoryRequest<{ resendStatus: string }>(
        `/inventory/objects/${objectId}/naming/resend`,
        csrfToken,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: "RESEND-CERTIFICATE" }),
        },
      );
      await loadNaming(objectId);
      setMessage(
        result.resendStatus === "sent"
          ? "The certificate link was resent."
          : "The certificate resend failed. The previous link still works.",
      );
    } catch (error) {
      setMessage(errorText(error, "The certificate could not be resent."));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!csrfToken) {
      return;
    }
    setBusy(true);
    try {
      await inventoryRequest("/inventory/session/logout", csrfToken, {
        method: "POST",
      });
    } catch {
      setMessage("Sign-in has ended.");
    } finally {
      setCsrfToken(undefined);
      setObjects(null);
      clearForm();
      setBusy(false);
    }
  }

  function clearForm() {
    setNaming(null);
    setCorrection("");
    setEditing(null);
    setName("");
    setDescription("");
    setDollars("");
    setFile(null);
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
  }

  function edit(object: InventoryObject) {
    setEditing(object);
    setName(object.name);
    setDescription(object.description);
    setDollars(centsToDollars(object.priceCents));
    setFile(null);
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setMessage("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) {
      return;
    }
    const priceCents = dollarsToCents(dollars);
    if (!name.trim() || priceCents === undefined) {
      setMessage("Enter a name and a price such as 20.00.");
      return;
    }
    if (file && file.size > PHOTO_LIMIT) {
      setMessage("Photographs must be 3 MB or smaller.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const wasEditing = editing;
      const saved = editing
        ? await inventoryRequest<InventoryObject>(
            `/inventory/objects/${editing.id}`,
            csrfToken,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: name.trim(),
                description: description.trim(),
                ...(editing.availability === "available"
                  ? { priceCents }
                  : {}),
              }),
            },
          )
        : await inventoryRequest<InventoryObject>("/inventory/objects", csrfToken, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim(),
              priceCents,
            }),
          });
      if (!wasEditing) {
        setEditing(saved);
      }
      if (file) {
        await inventoryRequest(`/inventory/objects/${saved.id}/photo`, csrfToken, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        });
      }
      clearForm();
      await loadObjects();
      setMessage(
        wasEditing
          ? "Saved."
          : "Added. It stays unpublished until you publish it.",
      );
    } catch (error) {
      setMessage(errorText(error, "The object was not saved."));
      if (error instanceof Error && "status" in error && error.status === 401) {
        setCsrfToken(undefined);
        setObjects(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(object: InventoryObject, published: boolean) {
    if (!csrfToken) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await inventoryRequest(`/inventory/objects/${object.id}`, csrfToken, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ published }),
      });
      await loadObjects();
    } catch (error) {
      setMessage(errorText(error, "The published state was not changed."));
    } finally {
      setBusy(false);
    }
  }

  if (!checkedSession) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="mt-3 text-stone-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!csrfToken || !objects) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="mt-3 text-stone-600">
          Staff sign-in for gift-card objects.
        </p>
        <form className="mt-6 space-y-3" onSubmit={(event) => void signIn(event)}>
          <label className="block text-sm font-medium" htmlFor="inventory-password">
            Password
          </label>
          <input
            id="inventory-password"
            className="w-full rounded border border-stone-300 px-3 py-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {message ? <p className="text-stone-800">{message}</p> : null}
          <button
            className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-60"
            type="submit"
            disabled={busy || password.length === 0}
          >
            Sign in
          </button>
        </form>
      </main>
    );
  }

  const priceLocked = editing !== null && editing.availability !== "available";
  const visible = filterStaffObjects(objects, {
    status: statusFilter,
    tier: tierFilter,
    query: search,
  });
  const customerCount = customerObjectCount(objects);
  const outstandingCount = outstandingNamingCount(objects);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <button
          className="rounded border border-stone-300 px-3 py-2 text-sm"
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
        >
          Log out
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-stone-600">
        New objects stay unpublished. Held and claimed objects keep their price.
        {customerCount} customer objects are in inventory. Test objects stay
        visible here and are excluded from that count. {outstandingCount} customer{" "}
        {outstandingCount === 1 ? "object is" : "objects are"} claimed and not named.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block text-sm font-medium" htmlFor="inventory-search">
          Search
          <input
            id="inventory-search"
            className="mt-1 w-full rounded border border-stone-300 px-3 py-3"
            value={search}
            placeholder="Object, submitted name, email, or order number"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <FilterGroup
          label="Status"
          options={STAFF_STATUS_FILTERS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterGroup
          label="Tier"
          options={STAFF_TIER_FILTERS}
          value={tierFilter}
          onChange={setTierFilter}
        />
        <p className="text-sm text-stone-700">
          Showing {visible.length} of {objects.length}
        </p>
      </div>
      {message ? <p className="mt-4 text-stone-800">{message}</p> : null}

      <form className="mt-8 grid gap-4 rounded border border-stone-200 bg-white p-5 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
        <h2 className="sm:col-span-2 text-lg font-semibold">
          {editing ? `Edit ${editing.name}` : "Add an object"}
        </h2>
        <label className="block text-sm font-medium">
          Name
          <input
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Gift-card price (CAD)
          <input
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2 disabled:bg-stone-100"
            inputMode="decimal"
            value={dollars}
            disabled={priceLocked}
            onChange={(event) => setDollars(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          Description
          <textarea
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          Photograph
          <input
            className="mt-1 block w-full text-sm"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              if (preview) {
                URL.revokeObjectURL(preview);
              }
              setPreview(next ? URL.createObjectURL(next) : null);
            }}
          />
        </label>
        {preview ? (
          <img src={preview} alt="" className="aspect-[4/3] w-full max-w-xs object-cover" />
        ) : null}
        <div className="flex gap-3 sm:col-span-2">
          <button
            className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {editing ? "Save" : "Add unpublished object"}
          </button>
          {editing ? (
            <button className="rounded border border-stone-300 px-4 py-2" type="button" onClick={clearForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <ul className="mt-8 grid gap-4">
        {visible.map((object) => {
          const photo = inventoryPhotoSrc(object.photoUrl);
          return (
            <li key={object.id} className={`rounded border border-l-4 border-stone-200 bg-white p-4 sm:flex sm:gap-4 ${stateTone(object.naming.state)}`}>
              <div className="w-full sm:w-40">
                <ObjectPhoto src={photo} name={object.name} />
              </div>
              <div className="mt-3 min-w-0 flex-1 sm:mt-0">
                <h2 className="text-lg font-semibold">
                  {object.name}
                  {object.isTest ? (
                    <span className="ml-2 rounded bg-stone-900 px-2 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-white">
                      Test
                    </span>
                  ) : null}
                </h2>
                {object.description ? (
                  <p className="mt-1 text-stone-600">{object.description}</p>
                ) : null}
                <p className="mt-2 font-medium">
                  {formatPrice(object.priceCents, object.currency)}
                  <span className="ml-2 text-sm font-normal text-stone-600">gift card</span>
                </p>
                <p className="mt-2">
                  <span className="inline-flex min-h-8 items-center rounded border border-current px-2 text-sm font-semibold">
                    {staffStateLabel(object.naming.state)}
                  </span>
                  <span className="ml-2 text-sm text-stone-700">
                    {object.published ? "Published" : "Unpublished"}
                  </span>
                </p>
                {staffAttentionLabel(object.naming) ? (
                  <p className="mt-2 text-sm font-semibold text-red-800">
                    {staffAttentionLabel(object.naming)}
                  </p>
                ) : null}
                {object.naming.state === "claimed_named" || object.naming.state === "claimed_unnamed" ? (
                  <p className="mt-2 text-xl font-semibold text-stone-950">
                    {object.naming.submittedName ?? "Not named yet."}
                  </p>
                ) : null}
                <PurchaserDetails naming={object.naming} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded border border-stone-300 px-3 py-2 text-sm" type="button" onClick={() => edit(object)}>
                    Edit
                  </button>
                  {staffCanPublish(object) ? (
                    <button
                      className="rounded border border-stone-300 px-3 py-2 text-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void setPublished(object, true)}
                    >
                      Publish
                    </button>
                  ) : null}
                  {object.published ? (
                    <button
                      className="rounded border border-stone-300 px-3 py-2 text-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void setPublished(object, false)}
                    >
                      Unpublish
                    </button>
                  ) : null}
                  {object.availability === "claimed" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void loadNaming(object.id)}
                    >
                      Naming
                    </button>
                  ) : null}
                </div>
                {naming?.objectId === object.id ? (
                  <form
                    className="mt-4 space-y-3 border-t border-stone-200 pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveCorrection(object.id);
                    }}
                  >
                    <p className="text-sm text-stone-700">
                      Submitted name: {naming.submittedName ?? "No name yet"}
                    </p>
                    <label className="block text-sm" htmlFor={`correction-${object.id}`}>
                      Corrected name
                      <input
                        id={`correction-${object.id}`}
                        value={correction}
                        maxLength={40}
                        className="mt-1 block w-full rounded border border-stone-300 px-3 py-2"
                        onChange={(event) => setCorrection(event.target.value)}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded bg-stone-900 px-3 py-2 text-white disabled:opacity-60"
                        disabled={busy || !naming.submittedName}
                      >
                        Save correction
                      </button>
                      <button
                        type="button"
                        className="rounded border border-stone-300 bg-white px-3 py-2 disabled:opacity-60"
                        disabled={busy || !naming.submittedName}
                        onClick={() => void resendCertificate(object.id)}
                      >
                        Resend certificate
                      </button>
                    </div>
                    <p className="text-sm text-stone-700">
                      Resend status: {naming.resendStatus ?? "not sent"} ({naming.resendCount})
                    </p>
                    {naming.revisions.length > 0 ? (
                      <ul className="space-y-1 text-sm text-stone-700">
                        {naming.revisions.map((revision) => (
                          <li key={`${revision.createdAt}-${revision.correctedName}`}>
                            {revision.previousName} → {revision.correctedName}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function stateTone(state: StaffNamingState): string {
  if (state === "on_hold") {
    return "border-l-amber-700";
  }
  if (state === "claimed_unnamed") {
    return "border-l-orange-700";
  }
  if (state === "claimed_named") {
    return "border-l-sky-800";
  }
  return "border-l-emerald-700";
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              className={`min-h-11 rounded border px-3 py-2 text-sm ${selected ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function PurchaserDetails({ naming }: { naming: StaffNamingView }) {
  const claimed = naming.state === "claimed_named" || naming.state === "claimed_unnamed";
  const hasDetails = Boolean(
    naming.purchaserName ||
      naming.purchaserEmail ||
      naming.purchaserPhone ||
      naming.orderNumber ||
      naming.paidAmountCents !== null ||
      naming.purchasedAt,
  );
  if (!claimed && !hasDetails) {
    return null;
  }
  if (!hasDetails) {
    return (
      <p className="mt-3 text-sm text-stone-700">
        No purchaser details are stored for this booking.
      </p>
    );
  }
  return (
    <dl className="mt-3 grid gap-1 text-sm text-stone-800">
      {naming.purchaserName ? (
        <div>
          <dt className="inline font-medium">Purchaser: </dt>
          <dd className="inline">{naming.purchaserName}</dd>
        </div>
      ) : null}
      {naming.purchaserEmail ? (
        <div>
          <dt className="inline font-medium">Email: </dt>
          <dd className="inline break-all">{naming.purchaserEmail}</dd>
        </div>
      ) : null}
      {naming.purchaserPhone ? (
        <div>
          <dt className="inline font-medium">Phone: </dt>
          <dd className="inline">{naming.purchaserPhone}</dd>
        </div>
      ) : null}
      {naming.orderNumber ? (
        <div>
          <dt className="inline font-medium">FareHarbor order: </dt>
          <dd className="inline">{naming.orderNumber}</dd>
        </div>
      ) : null}
      {naming.paidAmountCents !== null ? (
        <div>
          <dt className="inline font-medium">Payment: </dt>
          <dd className="inline">{formatPrice(naming.paidAmountCents, naming.currency ?? "CAD")}</dd>
        </div>
      ) : null}
      {naming.purchasedAt ? (
        <div>
          <dt className="inline font-medium">Purchase date: </dt>
          <dd className="inline">{formatTimestamp(naming.purchasedAt)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
