import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/guest", () => ({
  guestTokenFromParams: (t: string) => t,
  resolveGuestToken: vi.fn(async () => ({ stayId: "stay-1", hotelId: "hotel-1" })),
}));
vi.mock("@/server/room-service/orders", () => ({
  placeServiceOrder: vi.fn(async () => ({ ok: true, requestId: "req-1" })),
}));

import { placeServiceOrder } from "@/server/room-service/orders";
import { placeOrderAction } from "@/app/[lang]/g/[token]/menu/actions";

function cartForm(note?: string) {
  const form = new FormData();
  form.set("token", "tok-1");
  form.set("lang", "en");
  form.set("lines", JSON.stringify([{ serviceItemId: "item-1", qty: 1 }]));
  if (note !== undefined) form.set("guestNote", note);
  return form;
}

describe("room service cart note", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the note from the cart form to the order", async () => {
    await placeOrderAction(null, cartForm("No ice, please"));
    expect(placeServiceOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guestNote: "No ice, please" }),
    );
  });

  it("sends no note when the cart note is blank", async () => {
    await placeOrderAction(null, cartForm("   "));
    expect(placeServiceOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ guestNote: null }));
  });
});
