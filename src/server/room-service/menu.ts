import "server-only";
import { tenantDb } from "@/server/db";
import type { GuestStay } from "@/server/guest";

export type RoomServiceMenu = {
  key: string;
  nameEn: string;
  items: { id: string; nameEn: string; descriptionEn: string | null; price: number; imageUrl: string | null }[];
}[];

/** Dish photos by Ostro item key. Add a line here when a photo is saved under public/menu/. */
const DISH_PHOTOS: Record<string, string> = {
  "ostro-126": "/menu/biryani.jpg",
  "ostro-127": "/menu/biryani.jpg",
  "ostro-5": "/menu/acai-bowl.jpg",
  "ostro-56": "/menu/arabic-mixed-grill.jpg",
  "ostro-81": "/menu/acai-push-up-smoothie.jpg",
  "ostro-105": "/menu/almond-matcha-latte.jpg",
  "ostro-108": "/menu/americano.jpg",
  "ostro-41": "/menu/assorted-cheese-platter.jpg",
  "ostro-92": "/menu/avocado.jpg",
  "ostro-50": "/menu/baby-chicken.jpg",
  "ostro-94": "/menu/banana.jpg",
  "ostro-16": "/menu/beetroot-halloumi-salad.jpg",
  "ostro-61": "/menu/biryani-chicken.jpg",
  "ostro-109": "/menu/black-tea.jpg",
  "ostro-8": "/menu/blueberry-pancake.jpg",
  "ostro-33": "/menu/breaded-calamari.jpg",
  "ostro-76": "/menu/brownie.jpg",
  "ostro-99": "/menu/cappuccino.jpg",
  "ostro-95": "/menu/caramel-dream-blend.jpg",
  "ostro-77": "/menu/carrot-cake.jpg",
  "ostro-111": "/menu/chamomile.jpg",
  "ostro-46": "/menu/cheese-sandwich.jpg",
  "ostro-75": "/menu/cheesecake.jpg",
  "ostro-69": "/menu/chicken-bbq-pizza.jpg",
  "ostro-52": "/menu/chicken-burger.jpg",
  "ostro-13": "/menu/chicken-caesar-salad.jpg",
  "ostro-60": "/menu/chicken-cordon-bleu.jpg",
  "ostro-54": "/menu/chicken-harissa.jpg",
  "ostro-53": "/menu/chicken-mushroom-pie.jpg",
  "ostro-44": "/menu/chicken-quesadilla.jpg",
  "ostro-43": "/menu/chicken-shawarma.jpg",
  "ostro-55": "/menu/chicken-souvlaki.jpg",
  "ostro-11": "/menu/chicken-vegetable-clear-soup.jpg",
  "ostro-121": "/menu/chicken-wings.jpg",
  "ostro-31": "/menu/chicken-wings.jpg",
  "ostro-47": "/menu/chili-lime-salmon.jpg",
  "ostro-96": "/menu/classic-chill-vanilla.jpg",
  "ostro-117": "/menu/coca-cola-zero.jpg",
  "ostro-116": "/menu/coca-cola.jpg",
  "ostro-97": "/menu/coco-indulgence-smoothie.jpg",
  "ostro-9": "/menu/coconut-granola-bowl.jpg",
  "ostro-20": "/menu/creamy-coconut-soup.jpg",
  "ostro-22": "/menu/crunchy-munchy-salad.jpg",
  "ostro-23": "/menu/date-night-vegan-risotto.jpg",
  "ostro-112": "/menu/earl-grey-tea.jpg",
  "ostro-18": "/menu/emmental-peach-salad.jpg",
  "ostro-6": "/menu/english-breakfast.jpg",
  "ostro-102": "/menu/espresso.jpg",
  "ostro-118": "/menu/fanta.jpg",
  "ostro-49": "/menu/fish-and-chips.jpg",
  "ostro-101": "/menu/flat-white.jpg",
  "ostro-37": "/menu/french-fries-masala.jpg",
  "ostro-35": "/menu/french-fries.jpg",
  "ostro-88": "/menu/fresh-orange-juice.jpg",
  "ostro-78": "/menu/fruit-platter.jpg",
  "ostro-120": "/menu/ginger-ale.jpg",
  "ostro-15": "/menu/greek-salad.jpg",
  "ostro-28": "/menu/green-burner-drink.jpg",
  "ostro-110": "/menu/green-tea.jpg",
  "ostro-63": "/menu/grilled-lamb-chops.jpg",
  "ostro-48": "/menu/grilled-sea-bass.jpg",
  "ostro-123": "/menu/hale-hearty-lasagna.jpg",
  "ostro-24": "/menu/hale-hearty-lasagna.jpg",
  "ostro-122": "/menu/healthy-club-sandwich.jpg",
  "ostro-42": "/menu/healthy-club-sandwich.jpg",
  "ostro-7": "/menu/healthy-muesli.jpg",
  "ostro-29": "/menu/hello-sunshine.jpg",
  "ostro-79": "/menu/homemade-ice-cream.jpg",
  "ostro-104": "/menu/hot-chocolate.jpg",
  "ostro-115": "/menu/immunity-booster.jpg",
  "ostro-82": "/menu/kale-banana-pineapple-bash.jpg",
  "ostro-100": "/menu/latte.jpg",
  "ostro-91": "/menu/lemon-mint.jpg",
  "ostro-84": "/menu/lemon-turmeric-smoothie.jpg",
  "ostro-10": "/menu/lentil-soup-arabic.jpg",
  "ostro-12": "/menu/lobster-bisque.jpg",
  "ostro-107": "/menu/macchiato.jpg",
  "ostro-83": "/menu/mango-turmeric-breeze.jpg",
  "ostro-67": "/menu/margherita-pizza.jpg",
  "ostro-87": "/menu/matcha-fusion.jpg",
  "ostro-57": "/menu/mixed-seafood.jpg",
  "ostro-98": "/menu/mocha-cloud-frappe.jpg",
  "ostro-114": "/menu/moroccan-tea.jpg",
  "ostro-32": "/menu/mozzarella-sticks.jpg",
  "ostro-27": "/menu/nuts-about-cheesecake.jpg",
  "ostro-51": "/menu/ostro-burger.jpg",
  "ostro-45": "/menu/ostro-club-sandwich.jpg",
  "ostro-26": "/menu/panna-cotta-vubble.jpg",
  "ostro-73": "/menu/pasta-alfredo.jpg",
  "ostro-71": "/menu/penne-arrabbiata.jpg",
  "ostro-113": "/menu/peppermint-tea.jpg",
  "ostro-90": "/menu/pineapple.jpg",
  "ostro-1": "/menu/poached-eggs-on-toast.jpg",
  "ostro-38": "/menu/potato-wedges.jpg",
  "ostro-58": "/menu/roasted-lamb-shank.jpg",
  "ostro-124": "/menu/salmon-aloha-poke.jpg",
  "ostro-25": "/menu/say-yes-chocolate-cake.jpg",
  "ostro-2": "/menu/scrambled-eggs-mushrooms.jpg",
  "ostro-68": "/menu/seafood-pizza.jpg",
  "ostro-59": "/menu/seafood-truffle-risotto.jpg",
  "ostro-3": "/menu/shakshuka.jpg",
  "ostro-64": "/menu/shish-tawook.jpg",
  "ostro-14": "/menu/shrimp-avocado-salad.jpg",
  "ostro-72": "/menu/spaghetti-bolognese.jpg",
  "ostro-70": "/menu/spaghetti-carbonara.jpg",
  "ostro-19": "/menu/spiced-lentil-soup.jpg",
  "ostro-119": "/menu/sprite.jpg",
  "ostro-40": "/menu/steak-fries-bacon-cheese.jpg",
  "ostro-39": "/menu/steak-fries.jpg",
  "ostro-93": "/menu/sweet-melon.jpg",
  "ostro-36": "/menu/sweet-potato-fries.jpg",
  "ostro-34": "/menu/tempura-shrimp.jpg",
  "ostro-4": "/menu/the-arab.jpg",
  "ostro-74": "/menu/tiramisu.jpg",
  "ostro-17": "/menu/tomato-mozzarella-salad.jpg",
  "ostro-106": "/menu/turkish-coffee.jpg",
  "ostro-80": "/menu/umm-ali.jpg",
  "ostro-85": "/menu/unicorn-tears.jpg",
  "ostro-86": "/menu/vanilla-espresso-martini.jpg",
  "ostro-62": "/menu/vegetable-burger.jpg",
  "ostro-66": "/menu/veggie-delight.jpg",
  "ostro-89": "/menu/watermelon.jpg",
  "ostro-125": "/menu/zen-chicken.jpg",
  "ostro-30": "/menu/zesty-salmon.jpg",
};

/**
 * The Ostro menu as a guest sees it: active Ostro categories and their active items, and nothing at all
 * for a stay that is not active. Items are ordered by name, because the catalogue keeps no sort order
 * for them (ruling R6 in the plan).
 */
export async function listRoomServiceMenu(guest: GuestStay): Promise<RoomServiceMenu> {
  const db = tenantDb(guest.hotelId);
  const stay = await db.stay.findFirst({ where: { id: guest.stayId }, select: { status: true, tokenRevokedAt: true } });
  if (!stay || stay.status !== "ACTIVE" || stay.tokenRevokedAt) return [];

  const categories = await db.serviceCategory.findMany({
    where: { isActive: true, key: { startsWith: "ostro-" } },
    orderBy: { sort: "asc" },
    include: {
      items: {
        where: { isActive: true, deletedAt: null, externalKey: { startsWith: "ostro-" } },
        orderBy: { nameEn: "asc" },
        select: { id: true, nameEn: true, descriptionEn: true, price: true, externalKey: true },
      },
    },
  });

  return categories.map((c) => ({
    key: c.key,
    nameEn: c.nameEn,
    items: c.items.flatMap((i) =>
      i.price === null
        ? []
        : [{ id: i.id, nameEn: i.nameEn, descriptionEn: i.descriptionEn, price: Number(i.price), imageUrl: DISH_PHOTOS[i.externalKey ?? ""] ?? null }],
    ),
  }));
}
