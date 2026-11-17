import { notFound } from "next/navigation";
import { RoomServiceCart } from "@/components/room-service-cart";
import { isLocale } from "@/i18n";
import { guestTokenFromParams, resolveGuestToken } from "@/server/guest";
import { listRoomServiceMenu } from "@/server/room-service/menu";
import { placeOrderAction } from "./actions";

export default async function RoomServiceMenuPage({ params }: PageProps<"/[lang]/g/[token]/menu">) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest) notFound();
  const menu = await listRoomServiceMenu(guest);

  return (
    <>
      <h1 className="font-display text-2xl text-navy">Room service</h1>
      <RoomServiceCart token={token} lang={lang} menu={menu} action={placeOrderAction} />
    </>
  );
}
