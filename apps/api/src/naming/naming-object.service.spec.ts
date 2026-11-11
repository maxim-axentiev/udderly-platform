import assert from "node:assert/strict";
import test from "node:test";
import { NamingObjectService } from "./naming-object.service";

type StoredObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceAmount: number;
  currency: string;
  publishedAt: Date | null;
  isTest: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

test("create leaves publishedAt null unless publish is requested", async () => {
  const rows: StoredObject[] = [];
  const service = new NamingObjectService(fakeDatabase(rows) as never);

  const unpublished = await service.create({
    action: "add",
    name: "North gate",
    description: "",
    priceAmount: 2000,
    photoUrl: null,
    publish: false,
  });
  assert.equal(unpublished.publishedAt, null);
  assert.equal(unpublished.currency, "CAD");
  assert.equal(unpublished.status, "available");

  const published = await service.create({
    action: "add",
    name: "South gate",
    description: "Painted",
    priceAmount: 2500,
    photoUrl: "https://example.com/south.jpg",
    publish: true,
  });
  assert.ok(published.publishedAt instanceof Date);
  assert.equal(published.isTest, false);

  const testObject = await service.create({
    action: "add",
    name: "Campaign Test Object $100",
    description: "",
    priceAmount: 10000,
    photoUrl: null,
    publish: true,
    isTest: true,
  });
  assert.equal(testObject.isTest, true);
  assert.equal(testObject.publishedAt, null);
});

test("price edit is refused unless the object is available", async () => {
  const rows: StoredObject[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "North gate",
      description: "",
      photoUrl: null,
      priceAmount: 2000,
      currency: "CAD",
      publishedAt: null,
      isTest: false,
      status: "held",
      createdAt: new Date("2026-11-03T00:00:00Z"),
      updatedAt: new Date("2026-11-03T00:00:00Z"),
    },
  ];
  const service = new NamingObjectService(fakeDatabase(rows) as never);
  const result = await service.update({
    action: "edit",
    id: rows[0].id,
    priceAmount: 3000,
  });
  assert.equal(result.outcome, "price_locked");
  assert.equal(rows[0].priceAmount, 2000);
});

test("a test object stays unpublished", async () => {
  const rows: StoredObject[] = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Campaign Test Object $100",
      description: "",
      photoUrl: null,
      priceAmount: 10000,
      currency: "CAD",
      publishedAt: null,
      isTest: true,
      status: "available",
      createdAt: new Date("2026-11-03T00:00:00Z"),
      updatedAt: new Date("2026-11-03T00:00:00Z"),
    },
  ];
  const service = new NamingObjectService(fakeDatabase(rows) as never);
  const result = await service.update({
    action: "edit",
    id: rows[0].id,
    publish: true,
  });
  assert.equal(result.outcome, "test_object");
  assert.equal(rows[0].publishedAt, null);
  assert.equal(rows[0].isTest, true);
});

function fakeDatabase(rows: StoredObject[]) {
  return {
    db: {
      insert() {
        return {
          values(values: Omit<StoredObject, "id" | "createdAt" | "updatedAt">) {
            return {
              async returning() {
                const row: StoredObject = {
                  id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
                  createdAt: new Date("2026-11-03T00:00:00Z"),
                  updatedAt: new Date("2026-11-03T00:00:00Z"),
                  ...values,
                };
                rows.push(row);
                return [row];
              },
            };
          },
        };
      },
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return Promise.resolve(rows.slice(0, 1));
                  },
                };
              },
              orderBy() {
                return Promise.resolve(rows);
              },
            };
          },
        };
      },
      update() {
        return {
          set(patch: Partial<StoredObject>) {
            return {
              where() {
                return {
                  async returning() {
                    Object.assign(rows[0], patch);
                    return [rows[0]];
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}
