import { assertImportHost, type ExistingObject, type InventoryApi } from "./naming-inventory-import";

type StaffSession = {
  baseUrl: string;
  cookie: string;
  csrf: string;
  password: string;
};

export async function connectStaffInventory(
  baseUrl: string,
  password: string,
): Promise<InventoryApi> {
  const origin = assertImportHost(baseUrl).origin;
  const response = await fetch(endpoint(origin, "/inventory/session"), {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    throw await requestError(response, password);
  }
  const body = (await response.json()) as { csrfToken?: unknown };
  if (typeof body.csrfToken !== "string" || body.csrfToken.length === 0) {
    throw new Error("Staff sign-in did not return a CSRF token.");
  }
  const session: StaffSession = {
    baseUrl: origin,
    cookie: sessionCookie(response),
    csrf: body.csrfToken,
    password,
  };
  return {
    list: () => listObjects(session),
    create: (input) => createObject(session, input),
    uploadPhoto: (id, bytes) => uploadPhoto(session, id, bytes),
    readStaffPhoto: (photoUrl) => readStaffPhoto(session, photoUrl),
    readPublicPhoto: (photoUrl) => readPublicPhoto(session, photoUrl),
  };
}

async function listObjects(session: StaffSession): Promise<ExistingObject[]> {
  const response = await fetch(endpoint(session.baseUrl, "/inventory/objects"), {
    redirect: "error",
    headers: { cookie: session.cookie },
  });
  if (!response.ok) {
    throw await requestError(response, session.password);
  }
  const body = (await response.json()) as { objects?: unknown };
  if (!Array.isArray(body.objects)) {
    throw new Error("Inventory list did not return objects.");
  }
  return body.objects.map(parseObject);
}

async function createObject(
  session: StaffSession,
  input: { name: string; description: string; priceCents: number },
): Promise<ExistingObject> {
  const body: { name: string; description: string; priceCents: number } = {
    name: input.name,
    description: input.description,
    priceCents: input.priceCents,
  };
  const response = await fetch(endpoint(session.baseUrl, "/inventory/objects"), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await requestError(response, session.password);
  }
  return parseObject(await response.json());
}

async function uploadPhoto(
  session: StaffSession,
  id: string,
  bytes: Buffer,
): Promise<ExistingObject> {
  const response = await fetch(endpoint(session.baseUrl, `/inventory/objects/${id}/photo`), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/octet-stream",
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) {
    throw await requestError(response, session.password);
  }
  return parseObject(await response.json());
}

async function readStaffPhoto(
  session: StaffSession,
  photoUrl: string,
): Promise<{ status: number; bytes: Buffer }> {
  const response = await fetch(endpoint(session.baseUrl, `/inventory${photoPath(photoUrl)}`), {
    redirect: "error",
    headers: { cookie: session.cookie },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes };
}

async function readPublicPhoto(session: StaffSession, photoUrl: string): Promise<number> {
  const response = await fetch(endpoint(session.baseUrl, photoPath(photoUrl)), {
    redirect: "error",
  });
  return response.status;
}

function parseObject(value: unknown): ExistingObject {
  if (!value || typeof value !== "object") {
    throw new Error("Inventory response was missing an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.description !== "string" ||
    typeof record.priceCents !== "number" ||
    !Number.isInteger(record.priceCents) ||
    typeof record.availability !== "string" ||
    typeof record.published !== "boolean"
  ) {
    throw new Error("Inventory response was missing object fields.");
  }
  if (record.photoUrl !== null && typeof record.photoUrl !== "string") {
    throw new Error("Inventory response had an invalid photograph.");
  }
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    photoUrl: record.photoUrl,
    priceCents: record.priceCents,
    availability: record.availability,
    published: record.published,
  };
}

function sessionCookie(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const pair = cookies
    .map((value) => value.split(";")[0] ?? "")
    .find((value) => value.startsWith("naming_inventory="));
  if (!pair) {
    throw new Error("Staff sign-in did not return a session cookie.");
  }
  return pair;
}

function photoPath(photoUrl: string): string {
  if (!/^\/photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(photoUrl)) {
    throw new Error("Inventory photograph URL is not a stored staff photograph.");
  }
  return photoUrl;
}

function endpoint(origin: string, path: string): string {
  const url = new URL(path, origin);
  if (url.origin !== origin) {
    throw new Error("Refusing an inventory request that leaves the API origin.");
  }
  return url.toString();
}

async function requestError(response: Response, password: string): Promise<Error> {
  const text = await response.text();
  let detail = text.replace(/\s+/g, " ").slice(0, 240);
  if (password.length > 0) {
    detail = detail.split(password).join("[redacted]");
  }
  detail = detail.replace(/naming_inventory=[^;\s]+/g, "naming_inventory=[redacted]");
  return new Error(`Inventory request failed (HTTP ${response.status}): ${detail}`);
}
