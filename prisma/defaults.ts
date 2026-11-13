/** Starting departments and guest categories for every new hotel (editable afterwards). */

export const DEFAULT_DEPARTMENTS = [
  { code: "FO", nameEn: "Front Office", nameAr: "المكتب الأمامي" },
  { code: "HK", nameEn: "Housekeeping", nameAr: "التدبير المنزلي" },
  { code: "ENG", nameEn: "Engineering", nameAr: "الصيانة" },
  { code: "CONC", nameEn: "Concierge", nameAr: "الكونسيرج" },
  { code: "LAUN", nameEn: "Laundry", nameAr: "المغسلة" },
  { code: "FB", nameEn: "Food & Beverage", nameAr: "الأغذية والمشروبات" },
] as const;

// The 14 guest tiles from the brief. Only MVP services are active.
export const DEFAULT_CATEGORIES = [
  { key: "housekeeping", nameEn: "Housekeeping", nameAr: "التدبير المنزلي", icon: "sparkles", active: true },
  { key: "amenities", nameEn: "Room Amenities", nameAr: "مستلزمات الغرفة", icon: "gift", active: true },
  { key: "maintenance", nameEn: "Maintenance", nameAr: "الصيانة", icon: "wrench", active: true },
  { key: "laundry", nameEn: "Laundry", nameAr: "الغسيل", icon: "shirt", active: true },
  { key: "concierge", nameEn: "Concierge", nameAr: "الكونسيرج", icon: "bell", active: true },
  { key: "hotel_info", nameEn: "Hotel Information", nameAr: "معلومات الفندق", icon: "info", active: true },
  { key: "room_service", nameEn: "In-Room Dining", nameAr: "خدمة الغرف", icon: "utensils", active: false },
  { key: "restaurants", nameEn: "Restaurant Reservations", nameAr: "حجز المطاعم", icon: "calendar", active: false },
  { key: "transport", nameEn: "Transportation", nameAr: "المواصلات", icon: "car", active: false },
  { key: "spa", nameEn: "Spa & Wellness", nameAr: "السبا والعافية", icon: "flower", active: false },
  { key: "pool", nameEn: "Swimming Pool", nameAr: "المسبح", icon: "waves", active: false },
  { key: "gym", nameEn: "Gym & Fitness", nameAr: "النادي الرياضي", icon: "dumbbell", active: false },
  { key: "activities", nameEn: "Activities & Experiences", nameAr: "الأنشطة والتجارب", icon: "compass", active: false },
  { key: "feedback", nameEn: "Guest Feedback", nameAr: "آراء الضيوف", icon: "star", active: false },
];
