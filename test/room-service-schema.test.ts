import { afterAll, describe, expect, it } from "vitest";
import { adminDb, createHotelWithData } from "./fixtures";

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("room service schema", () => {
  it("a catalogue item can carry an external key, unique per hotel", async () => {
    const { hotelId, dept, item } = await createHotelWithData("rs-schema");
    await adminDb.serviceItem.update({ where: { id: item.id }, data: { externalKey: "ostro-1" } });
    await expect(
      adminDb.serviceItem.create({
        data: {
          hotelId,
          categoryId: item.categoryId,
          departmentId: dept.id,
          nameEn: "Duplicate",
          nameAr: "Duplicate",
          externalKey: "ostro-1",
        },
      }),
    ).rejects.toThrow();
  });

  it("an order line keeps its name and unit price after the catalogue item changes", async () => {
    const { hotelId, item, createStay, createRequest } = await createHotelWithData("rs-line");
    const { stay } = await createStay();
    const request = await createRequest(stay.id);
    const order = await adminDb.serviceOrder.create({ data: { hotelId, requestId: request.id } });
    await adminDb.serviceOrderLine.create({
      data: { hotelId, orderId: order.id, serviceItemId: item.id, nameSnapshot: "Shakshuka", unitPrice: "59", qty: 2 },
    });
    await adminDb.serviceItem.update({ where: { id: item.id }, data: { nameEn: "Renamed", price: "99" } });

    const line = await adminDb.serviceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    expect(line.nameSnapshot).toBe("Shakshuka");
    expect(Number(line.unitPrice)).toBe(59);
  });
});
