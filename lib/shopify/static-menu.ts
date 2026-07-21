/**
 * Fallback Online Store mega-menu tree (RDX navigation).
 * Used when the Admin menu API is unavailable, and to recognise bare
 * browse phrases that match real nav labels (Boxing Gloves, Kara, etc.).
 */

export type StaticMenuDef = {
  title: string;
  children?: StaticMenuDef[];
};

/** Main-nav structure matching the storefront mega menus. */
export const STATIC_MENU_DEFS: StaticMenuDef[] = [
  {
    title: "Boxing",
    children: [
      {
        title: "Approved Ranges",
        children: [{ title: "IBA Approved Boxing Range" }],
      },
      {
        title: "Boxing Gloves",
        children: [
          { title: "Boxing Competition Gloves" },
          { title: "Boxing Sparring Gloves" },
          { title: "Boxing Training Gloves" },
          { title: "Kids Boxing Gloves" },
          { title: "Bag Gloves" },
          { title: "Boxing Gloves & Pads" },
        ],
      },
      {
        title: "Punch Bags",
        children: [
          { title: "Training Punching Bags" },
          { title: "Punching Bags & Mitts Sets" },
          { title: "Freestanding Punch Bags" },
          { title: "Professional Punch Bags" },
          { title: "Angle & Uppercut Bags" },
          { title: "Double End Bags" },
          { title: "Speed Bags & Platforms" },
          { title: "Kids Punch Bags" },
          { title: "Accessories" },
        ],
      },
      {
        title: "Coaching Equipment",
        children: [
          { title: "Boxing Pads" },
          { title: "Punch Paddles" },
          { title: "Boxing Sticks" },
          { title: "Body Protectors" },
        ],
      },
      {
        title: "Protective Gear",
        children: [
          { title: "Hand Wraps & Inner Gloves" },
          { title: "Head Guards" },
          { title: "Mouth Guards" },
          { title: "Chest Guards" },
          { title: "Groin Guards" },
          { title: "Knee Wraps" },
        ],
      },
      {
        title: "Training Equipment",
        children: [
          { title: "Skipping Ropes" },
          { title: "Pull Up Bars" },
          { title: "Fitness Sandbags" },
          { title: "Leg Stretchers" },
        ],
      },
      {
        title: "Apparel",
        children: [
          { title: "Boxing Shorts" },
          { title: "Compression Wear" },
          { title: "T-Shirts & Vests" },
          { title: "Sauna Suits" },
        ],
      },
    ],
  },
  {
    title: "MMA",
    children: [
      {
        title: "Approved Ranges",
        children: [
          { title: "IMMAF Approved Range" },
          { title: "Wako Approved Range" },
        ],
      },
      {
        title: "MMA Gloves",
        children: [
          { title: "Sparring Gloves" },
          { title: "Training Gloves" },
          { title: "Kids MMA Gloves" },
        ],
      },
      {
        title: "MMA Punch Bags",
        children: [
          { title: "MMA Training Punch Bags" },
          { title: "MMA Punch Bag Sets" },
          { title: "MMA Punching Bags & Mitts Sets" },
          { title: "Freestanding Punch Bags" },
          { title: "Angle & Uppercut Bags" },
          { title: "Accessories" },
          { title: "MMA Kids Punch Bags" },
          { title: "Speed Bags & Platforms" },
        ],
      },
      {
        title: "Coaching Equipment",
        children: [
          { title: "Focus Mitts" },
          { title: "Kicking Shields" },
          { title: "Thai Pads" },
          { title: "Chest Guard" },
        ],
      },
      {
        title: "Protective Gear",
        children: [
          { title: "Hand Wraps & Inner Gloves" },
          { title: "Head Guard" },
          { title: "Mouth Guards" },
          { title: "Chest Guards" },
          { title: "Groin Guards" },
          { title: "Knee Wraps" },
          { title: "Shin Guards" },
        ],
      },
      {
        title: "Training Equipment",
        children: [
          { title: "Skipping Ropes" },
          { title: "Pull Up Bars" },
          { title: "Fitness Sandbags" },
          { title: "Leg Stretchers" },
        ],
      },
      {
        title: "Apparel",
        children: [
          { title: "MMA Shorts" },
          { title: "Compression Wear" },
          { title: "Sauna Suits" },
        ],
      },
    ],
  },
  {
    title: "Fitness",
    children: [
      {
        title: "Gym Gloves",
        children: [
          { title: "Fitness & Workout Gloves" },
          { title: "Training & Gym Gloves" },
          { title: "Heavy Weight Lifting Gloves" },
        ],
      },
      {
        title: "Gym Belts",
        children: [
          { title: "Leather Belts" },
          { title: "Training Belts" },
          { title: "Dipping Belts" },
          { title: "Powerlifting Belts" },
        ],
      },
      {
        title: "Weightlifting Gear",
        children: [
          { title: "Weightlifting Grips & Straps" },
          { title: "Arm Blaster" },
          { title: "AB Strap & Triceps Rope" },
          { title: "Head Harness" },
        ],
      },
      {
        title: "Strength Training",
        children: [
          { title: "Pull Up Bars" },
          { title: "Skipping Ropes" },
          { title: "Leg Stretcher" },
          { title: "Fitness Sandbags" },
          { title: "Kettlebells" },
        ],
      },
      {
        title: "Stability & Mobility",
        children: [
          { title: "Ab Rollers" },
          { title: "Aerobic Step" },
          { title: "Balance Boards" },
          { title: "Resistance Bands" },
          { title: "Resistance Tubes" },
        ],
      },
      {
        title: "Braces & Support",
        children: [
          { title: "Elbow Support" },
          { title: "Back Support" },
          { title: "Wrist Support" },
          { title: "Knee Support" },
          { title: "Ankle Support" },
        ],
      },
      {
        title: "Gym Essentials",
        children: [
          { title: "Sauna Suits" },
          { title: "Compression Wear" },
          { title: "Equipment Bags" },
        ],
      },
    ],
  },
  {
    title: "Yoga",
    children: [
      {
        title: "Yoga",
        children: [
          { title: "Cork Yoga Mat" },
          { title: "PU Mat" },
          { title: "TPE Mat" },
          { title: "PVC Mat" },
          { title: "Cork Yoga Block" },
          { title: "EVA Yoga Block" },
          { title: "Plain Yoga Strap" },
          { title: "Color Yoga Strap" },
          { title: "Gym Ball" },
          { title: "Balance Trainer" },
        ],
      },
      {
        title: "Yoga Mats",
        children: [
          { title: "PVC Yoga Mats" },
          { title: "TPE Yoga Mats" },
          { title: "Cork Yoga Mats" },
          { title: "PU Yoga Mats" },
        ],
      },
      {
        title: "Yoga Blocks",
        children: [
          { title: "EVA Foam Blocks" },
          { title: "Cork Block" },
        ],
      },
      {
        title: "Yoga Strap",
        children: [
          { title: "Plain Yoga Straps" },
          { title: "Color Yoga Straps" },
        ],
      },
      {
        title: "Yoga Balls",
        children: [
          { title: "Yoga Ball With Base" },
          { title: "Balance Trainer Ball" },
        ],
      },
      {
        title: "Stability & Mobility",
        children: [
          { title: "Ab Rollers" },
          { title: "Aerobic Steps" },
          { title: "Balance Boards" },
          { title: "Bands & Tubes" },
        ],
      },
    ],
  },
  {
    title: "Apparel",
    children: [
      {
        title: "Active Wear",
        children: [
          { title: "Trousers" },
          { title: "T-Shirts" },
          { title: "Vest" },
        ],
      },
      {
        title: "Compression Wear & Shorts",
        children: [
          { title: "MMA Shorts" },
          { title: "Compression Shorts & Pants" },
          { title: "Sweatshirts" },
        ],
      },
      {
        title: "Sauna Range",
        children: [
          { title: "Sauna Suits" },
          { title: "Sauna Vests" },
          { title: "Sauna T-Shirts" },
          { title: "Sauna Shorts" },
          { title: "Sauna Leggings" },
        ],
      },
    ],
  },
  {
    title: "Collections",
    children: [
      {
        title: "Series",
        children: [
          { title: "APEX" },
          { title: "MARK" },
          { title: "AURA+" },
          { title: "KARA" },
          { title: "NOIR" },
          { title: "NERO" },
          { title: "HARRIER" },
          { title: "AURA" },
          { title: "EGO" },
        ],
      },
      {
        title: "Ranges",
        children: [
          { title: "Skipping Ropes" },
          { title: "Braces & Supports" },
          { title: "Sauna Range 2.0" },
          { title: "Karate" },
          { title: "BJJ Gi" },
        ],
      },
      {
        title: "Approvals / Certifications",
        children: [
          { title: "BRAVE CF Approved" },
          { title: "IMMAF Approved" },
          { title: "Wako Approved Range" },
          { title: "IBA (AIBA) Approved" },
          { title: "BBBofC Approved" },
          { title: "FIGMMA Approved" },
          { title: "IPL Approved" },
          { title: "SMMAF Approved" },
          { title: "USPA Approved" },
          { title: "GPC Approved" },
          { title: "WPC Approved" },
          { title: "EMMAA Approved" },
        ],
      },
    ],
  },
  {
    title: "Kids",
    children: [
      { title: "Kids Boxing Set" },
      { title: "Kids Boxing Gloves" },
      { title: "Kids MMA Gloves" },
      { title: "Kids Head Guard" },
      { title: "Kids Punch Bags" },
      { title: "Kids Focus Pads" },
    ],
  },
];

/** Extra short/ambiguous browse terms that are not exact nav titles. */
export const EXTRA_BROWSE_PHRASES = [
  "equipment",
  "accessories",
  "clothing",
  "protein",
  "nutrition",
  "sauna",
  "sauna range",
  "sauna suits",
  "sauna suit",
  "sauna shorts",
  "sauna vests",
  "sauna vest",
  "sauna t-shirts",
  "sauna t-shirt",
  "sauna leggings",
  "sweat shorts",
  "sweat suit",
  "gloves",
  "glove",
  "shorts",
  "short",
  "wraps",
  "wrap",
  "hand wraps",
  "headguard",
  "headguards",
  "head guard",
  "head guards",
  "punching bag",
  "punching bags",
  "punch bag",
  "punch bags",
  "shoes",
  "boots",
  "boxing glove",
  "mma glove",
  "boxing boots",
  "boxing shoes",
  "belts",
  "belt",
  "mats",
  "mat",
  "pads",
  "mitts",
  "series",
  "ranges",
  "approvals",
  "certifications",
] as const;

function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function walkTitles(defs: StaticMenuDef[], out: Set<string>): void {
  for (const def of defs) {
    const n = normalizePhrase(def.title);
    if (n) out.add(n);
    // Also keep a lighter form without filler words for matching.
    const compact = n
      .split(" ")
      .filter((w) => w !== "and" && w !== "the")
      .join(" ");
    if (compact) out.add(compact);
    if (def.children?.length) walkTitles(def.children, out);
  }
}

let cachedPhrases: Set<string> | null = null;

/** All normalised nav labels + extra browse synonyms for intent matching. */
export function getKnownBrowsePhrases(): Set<string> {
  if (cachedPhrases) return cachedPhrases;
  const phrases = new Set<string>();
  walkTitles(STATIC_MENU_DEFS, phrases);
  for (const p of EXTRA_BROWSE_PHRASES) {
    phrases.add(normalizePhrase(p));
  }
  cachedPhrases = phrases;
  return phrases;
}

export function isKnownBrowsePhrase(text: string): boolean {
  const n = normalizePhrase(text);
  if (!n) return false;
  return getKnownBrowsePhrases().has(n);
}

export function normalizeBrowsePhrase(text: string): string {
  return normalizePhrase(text);
}
