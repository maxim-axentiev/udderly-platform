import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { availabilityLabel, formatPrice } from "../naming/format";
import { ObjectPhoto } from "../naming/object-photo";
import {
  centsToDollars,
  dollarsToCents,
  inventoryPhotoSrc,
  inventoryRequest,
  staffCanPublish,
  type InventoryObject,
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
      </p>
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
        {objects.map((object) => {
          const photo = inventoryPhotoSrc(object.photoUrl);
          return (
            <li key={object.id} className="rounded border border-stone-200 bg-white p-4 sm:flex sm:gap-4">
              <div className="w-full sm:w-40">
                <ObjectPhoto src={photo} name={object.name} />
              </div>
              <div className="mt-3 min-w-0 flex-1 sm:mt-0">
                <h2 className="text-lg font-semibold">{object.name}</h2>
                {object.description ? (
                  <p className="mt-1 text-stone-600">{object.description}</p>
                ) : null}
                <p className="mt-2 font-medium">
                  {formatPrice(object.priceCents, object.currency)}
                  <span className="ml-2 text-sm font-normal text-stone-600">gift card</span>
                </p>
                <p className="mt-1 text-sm text-stone-700">
                  {availabilityLabel(object.availability)}
                  <span className="ml-2">{object.published ? "Published" : "Unpublished"}</span>
                  {object.isTest ? <span className="ml-2">Test object</span> : null}
                </p>
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
