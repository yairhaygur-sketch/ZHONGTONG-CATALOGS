"use client";

import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BusFront, Camera, Check, CheckCircle2, Clock3, Columns2, Copy, FileText, Image as ImageIcon, Images, Layers3, ListTree, LoaderCircle, LogIn, Minus, Pencil, Plus, Printer, RotateCcw, ScanSearch, Share2, ShieldCheck, Sparkles, Trash2, Upload, Wrench, X } from "lucide-react";
type Occurrence = {
  partNumber: string;
  description: string;
  descriptionChinese: string;
  quantity: string;
  unit: string;
  notes: string;
  assembly: string;
  assemblyCode: string;
  model: string;
  year: string;
  engine: string;
  vehicleType: string;
  representativeVin: string;
  vinCount: number;
  catalog: string;
  groupId: string;
  position?: string;
};

type Part = {
  partNumber: string;
  description: string;
  descriptionChinese: string;
  descriptionHebrew?: string;
  models: string[];
  years: string[];
  assemblies: string[];
  occurrences: Occurrence[];
};

type Data = {
  catalogCount: number;
  uniqueParts: number;
  occurrenceCount: number;
  parts: Part[];
  catalogs: {
    catalog: string;
    vinNumbers?: string[];
    model?: string;
    year?: string;
    engine?: string;
    vehicleType?: string;
    parts?: number;
    vins?: number;
  }[];
  groups: Record<string, { catalog: string; code: string; title: string; parts: string[]; figure: string }>;
  figureCount: number;
};

const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
const normalizeVin = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const searchTokens = (value: string) => value.toUpperCase().split(/[^A-Z0-9\u0590-\u05FF\u4E00-\u9FFF]+/).filter(Boolean);
const matchesSearch = (haystack: string, needle: string) => {
  const haystackTokens = searchTokens(haystack);
  return searchTokens(needle).every((token) => haystackTokens.some((item) => item.includes(token)));
};
const displayPartDescription = (part: Part | undefined, he: boolean, fallback: string) => (
  (he ? part?.descriptionHebrew : "")
  || part?.description
  || part?.descriptionChinese
  || fallback
);
const compareDiagramPositions = (a?: string, b?: string) => {
  const aPosition = a?.trim() ?? "";
  const bPosition = b?.trim() ?? "";
  if (!aPosition && !bPosition) return 0;
  if (!aPosition) return 1;
  if (!bPosition) return -1;
  return aPosition.localeCompare(bPosition, "en", { numeric: true, sensitivity: "base" });
};

type SearchMode = "part" | "description" | "vin" | "browse" | "photos";
type PartDetailTab = "diagram" | "photos" | "fitment" | "related" | "notes";
type WorkbenchView = "split" | "diagram" | "list";
type CategoryId = "powertrain" | "drive" | "axles" | "steering" | "brakes" | "electrical" | "body" | "interior" | "hvac" | "other";
type AssistantPartResult = {
  partNumber: string;
  description: string;
  assembly: string;
  position: string;
  confidence?: SmartMatchConfidence;
  reason?: string;
};
type AssistantMessage = {
  role: "assistant" | "user";
  text: string;
  results?: AssistantPartResult[];
  suggestions?: string[];
};
type RealPartPhoto = {
  key: string;
  url: string;
  fileName: string;
  contentType: string;
  uploadedAt: string;
  source: "warehouse" | "manufacturer" | "workshop" | "other";
  vin: string;
  status: "verified" | "pending";
};
type PhotoPartSummary = {
  partNumber: string;
  photoCount: number;
  verifiedCount: number;
  pendingCount: number;
  latestPhoto: RealPartPhoto;
};

const MAX_ORIGINAL_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PREPARED_PHOTO_BYTES = 1_250_000;
const MAX_PREPARED_PHOTO_EDGE = 1600;

function CopyPartNumberButton({ partNumber, he, compact = false }: { partNumber: string; he: boolean; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyPartNumber = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(partNumber);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = partNumber;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return <button
    type="button"
    className={`copyPartButton${copied ? " copied" : ""}${compact ? " compact" : ""}`}
    onClick={copyPartNumber}
    aria-label={copied
      ? (he ? `המק״ט ${partNumber} הועתק` : `${partNumber} copied`)
      : (he ? `העתקת המק״ט ${partNumber}` : `Copy part number ${partNumber}`)}
    title={he ? "העתק מק״ט" : "Copy part number"}
  >
    {copied ? <Check size={compact ? 11 : 13} aria-hidden="true" /> : <Copy size={compact ? 11 : 13} aria-hidden="true" />}
    <span aria-live="polite">{copied ? (he ? "הועתק" : "Copied") : (he ? "העתק" : "Copy")}</span>
  </button>;
}

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

async function preparePhotoFile(file: File, partNumber: string) {
  if (!file.type.startsWith("image/")) throw new Error("type");
  if (file.size > MAX_ORIGINAL_PHOTO_BYTES) throw new Error("original-size");

  if (
    file.size <= MAX_PREPARED_PHOTO_BYTES
    && ["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PREPARED_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  let width = Math.max(1, Math.round(bitmap.width * scale));
  let height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("prepare");
  }

  let blob: Blob | null = null;
  for (const quality of [0.84, 0.74, 0.64]) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(bitmap, 0, 0, width, height);
    blob = await canvasBlob(canvas, quality);
    if (blob && blob.size <= MAX_PREPARED_PHOTO_BYTES) break;
    width = Math.max(1, Math.round(width * 0.84));
    height = Math.max(1, Math.round(height * 0.84));
  }
  bitmap.close();

  if (!blob || blob.size > MAX_PREPARED_PHOTO_BYTES) throw new Error("prepare");
  const safePartNumber = partNumber.replace(/[^A-Z0-9_-]/gi, "_");
  return new File([blob], `${safePartNumber}_${Date.now()}.jpg`, { type: "image/jpeg" });
}
type SmartSearchRule = {
  id: string;
  aliases: string[];
  terms: string[];
  exclude?: string[];
  he: string;
  en: string;
};
type SmartMatchConfidence = "strong" | "good" | "possible";
type SmartMatch = {
  score: number;
  confidence: SmartMatchConfidence;
  reasonHe: string;
  reasonEn: string;
  detailsHe: string[];
  detailsEn: string[];
  understoodHe: string;
  understoodEn: string;
};
type SmartQueryAnalysis = {
  cleaned: string;
  rawTokens: string[];
  translatedTokens: string[];
  semanticGroups: { he: string; en: string; tokens: string[] }[];
  partNumber?: string;
  rule?: SmartSearchRule;
  category?: CategoryId;
  side?: "left" | "right";
  year?: string;
  models: string[];
  position?: string;
  understoodHe: string;
  understoodEn: string;
};
type VinBrowseState = {
  vin: string;
  category: "all" | CategoryId;
  textFilter: string;
  visibleCount: number;
  assistantQuery: string;
  messages: AssistantMessage[];
  scrollY: number;
};
type CatalogBrowseState = {
  catalog: string;
  category: "all" | CategoryId;
  groupId: string;
  partSearch?: string;
  scrollY: number;
};
type CatalogHistoryState =
  | { ztCatalogView: "vin"; vinState: VinBrowseState }
  | { ztCatalogView: "part"; partNumber: string; vinState?: VinBrowseState; searchMode?: "part" | "description"; searchQuery?: string; fromPhotos?: boolean }
  | { ztCatalogView: "search"; searchMode: "part" | "description"; searchQuery: string }
  | { ztCatalogView: "browse"; browseState: CatalogBrowseState }
  | { ztCatalogView: "catalog-part"; partNumber: string; browseState: CatalogBrowseState }
  | { ztCatalogView: "photos" };

type ParsedAppRoute = {
  language: "he" | "en";
  mode: SearchMode;
  query: string;
  submitted: string;
  browseState: CatalogBrowseState | null;
  browseCategory?: CategoryId | null;
};

const appUrl = (path: string, language: "he" | "en", params: Record<string, string | undefined> = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  if (language === "en") search.set("lang", "en");
  const queryString = search.toString();
  return `${path}${queryString ? `?${queryString}` : ""}`;
};

const parseAppRoute = (): ParsedAppRoute => {
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang") === "en" ? "en" : "he";
  const segments = window.location.pathname.split("/").filter(Boolean);
  const decodeSegment = (value = "") => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  if (segments[0] === "part" && segments[1]) {
    const partNumber = decodeSegment(segments.slice(1).join("/")).trim().toUpperCase();
    return { language, mode: "part", query: partNumber, submitted: partNumber, browseState: null };
  }

  if (segments[0] === "vin" && segments[1]) {
    const vin = normalizeVin(decodeSegment(segments[1]));
    return { language, mode: "vin", query: vin, submitted: vin, browseState: null };
  }

  if (segments[0] === "search" && (segments[1] === "part" || segments[1] === "description")) {
    const searchMode = segments[1] as "part" | "description";
    const searchQuery = params.get("q")?.trim() ?? "";
    return { language, mode: searchMode, query: searchQuery, submitted: searchQuery, browseState: null };
  }

  if (segments[0] === "catalogs") {
    const categoryParam = params.get("category");
    const category = categoryParam === "all" || CATEGORIES.some((item) => item.id === categoryParam)
      ? categoryParam as "all" | CategoryId
      : "all";
    const catalog = params.get("catalog") ?? "";
    return {
      language,
      mode: "browse",
      query: "",
      submitted: "",
      browseCategory: category === "all" ? null : category,
      browseState: catalog ? {
        catalog,
        category,
        groupId: params.get("group") ?? "",
        partSearch: params.get("q") ?? "",
        scrollY: 0,
      } : null,
    };
  }

  if (segments[0] === "photos") {
    return { language, mode: "photos", query: "", submitted: "", browseState: null };
  }

  return { language, mode: "part", query: "", submitted: "", browseState: null };
};

const searchValidationMessage = (mode: SearchMode, value: string, he: boolean) => {
  const trimmed = value.trim();
  if (!trimmed) return he ? "יש להזין ערך לחיפוש." : "Enter a search value.";
  if (mode === "vin") {
    const vin = normalizeVin(trimmed);
    if (vin.length !== 17) return he ? "מספר שלדה חייב להכיל בדיוק 17 תווים." : "A VIN must contain exactly 17 characters.";
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return he ? "מספר השלדה כולל תו שאינו תקין. אין להשתמש באותיות I, O או Q." : "The VIN contains an invalid character. I, O and Q are not used.";
  }
  if ((mode === "part" || mode === "description") && trimmed.length < 2) {
    return he ? "החיפוש קצר מדי. יש להזין לפחות שני תווים." : "The search is too short. Enter at least two characters.";
  }
  return "";
};

const CATEGORIES: { id: CategoryId; he: string; en: string; aliases: string[] }[] = [
  { id: "powertrain", he: "מנוע וקירור", en: "Engine & cooling", aliases: ["מנוע", "קירור", "רדיאטור", "engine", "cooling", "radiator"] },
  { id: "drive", he: "תיבת הילוכים והינע", en: "Transmission & drive", aliases: ["גיר", "תיבת הילוכים", "הינע", "גל הינע", "transmission", "gearbox", "drive shaft", "driveline"] },
  { id: "axles", he: "סרנים, מתלים וגלגלים", en: "Axles, suspension & wheels", aliases: ["סרן", "סרנים", "מתלים", "גלגל", "צמיג", "axle", "suspension", "wheel", "tire"] },
  { id: "steering", he: "היגוי", en: "Steering", aliases: ["היגוי", "הגה", "steering"] },
  { id: "brakes", he: "בלמים ואוויר", en: "Brakes & pneumatics", aliases: ["בלם", "בלמים", "רפידות", "דיסק", "אוויר", "brake", "brakes", "pad", "disc", "pneumatic"] },
  { id: "electrical", he: "חשמל ובקרה", en: "Electrical & control", aliases: ["חשמל", "מצבר", "סוללה", "בקרה", "חיישן", "פיוז", "electric", "electrical", "battery", "sensor", "fuse", "control"] },
  { id: "body", he: "מרכב חוץ ודלתות", en: "Body & doors", aliases: ["מרכב", "דלת", "חלון", "פנס", "מראה", "מגב", "body", "door", "window", "lamp", "mirror", "wiper"] },
  { id: "interior", he: "פנים, מושבים ואביזרים", en: "Interior, seats & accessories", aliases: ["פנים", "מושב", "כיסא", "אביזר", "תא נהג", "interior", "seat", "accessory", "dashboard", "cabin"] },
  { id: "hvac", he: "מיזוג וחימום", en: "A/C & heating", aliases: ["מיזוג", "מזגן", "חימום", "הפשרה", "air conditioning", "a/c", "heating", "defroster"] },
  { id: "other", he: "ציוד ומכלולים נוספים", en: "Other assemblies", aliases: ["אחר", "נוסף", "other", "misc"] },
];

function SystemIcon({ category }: { category: CategoryId }) {
  const common = {
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (category === "powertrain") return <svg {...common}>
    <path d="M7 11h3l2-3h8l2 3h3v12h-3l-2 3H10l-2-3H5v-9h2z" />
    <path d="M13 8V5h5M25 14h3v6h-3M11 15h8v6h-8z" />
  </svg>;

  if (category === "drive") return <svg {...common}>
    <circle cx="10" cy="16" r="5" />
    <circle cx="10" cy="16" r="2" />
    <circle cx="23" cy="16" r="3.5" />
    <path d="M15 16h4.5M5 16H2M26.5 16H30M10 11V8M10 24v-3" />
  </svg>;

  if (category === "axles") return <svg {...common}>
    <circle cx="6" cy="16" r="4" />
    <circle cx="26" cy="16" r="4" />
    <path d="M10 16h12M13 16l2-5 2 10 2-5" />
  </svg>;

  if (category === "steering") return <svg {...common}>
    <circle cx="16" cy="16" r="11" />
    <circle cx="16" cy="16" r="3" />
    <path d="M5.5 14h21M16 19v8M13.5 17.5 9 24M18.5 17.5 23 24" />
  </svg>;

  if (category === "brakes") return <svg {...common}>
    <circle cx="15" cy="16" r="10" />
    <circle cx="15" cy="16" r="3" />
    <path d="M22 9.5h5v13h-5l-2-3V13zM12 7l2 4M12 25l2-4" />
  </svg>;

  if (category === "electrical") return <svg {...common}>
    <path d="M6 10h20v14H6zM11 7v3M21 7v3M10 17h5M12.5 14.5v5M19 17h4" />
    <path d="m17 11-3 6h4l-2 5" />
  </svg>;

  if (category === "body") return <svg {...common}>
    <path d="M4 9h20l4 5v9H4zM4 14h24M9 9v5M20 9v14" />
    <circle cx="9" cy="24" r="2.5" />
    <circle cx="24" cy="24" r="2.5" />
    <path d="M22.5 16h3" />
  </svg>;

  if (category === "interior") return <svg {...common}>
    <path d="M11 5v11c0 2 1 3 3 3h8v7M11 13H8c-2 0-3 1-3 3v4h17" />
    <path d="M8 20v6M21 20v6" />
  </svg>;

  if (category === "hvac") return <svg {...common}>
    <circle cx="16" cy="16" r="2" />
    <path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12M16 4l-3 3M16 4l3 3M16 28l-3-3M16 28l3-3" />
  </svg>;

  return <svg {...common}>
    <path d="m5 11 6-4 6 4-6 4zM11 15v8l-6-4v-8M17 11v8l-6 4M18 15l5-3 5 3-5 3zM23 18v7l-5-3v-7M28 15v7l-5 3" />
  </svg>;
}

const SMART_SEARCH_RULES: SmartSearchRule[] = [
  {
    id: "front-windshield",
    aliases: ["שמשה קדמית", "שימשה קדמית", "שמשה קידמית", "חלון קדמי", "front windshield", "front windscreen", "windscreen"],
    terms: ["front windshield glass", "front windshield", "front windscreen", "windscreen glass"],
    exclude: ["rear", "back", "washer", "wiper", "beam", "crossbeam", "support", "switch", "trim", "stopper", "frame", "rubber", "seal", "film", "guardrail", "sunshade", "shade", "curtain"],
    he: "שמשה קדמית",
    en: "front windshield",
  },
  {
    id: "rear-windshield",
    aliases: ["שמשה אחורית", "שימשה אחורית", "חלון אחורי", "rear windshield", "rear windscreen", "back windshield"],
    terms: ["rear windshield", "rear windscreen", "back windshield", "rear window glass", "rear glass"],
    exclude: ["trim", "beam", "support", "switch", "rubber", "seal", "frame", "heater"],
    he: "שמשה אחורית",
    en: "rear windshield",
  },
  {
    id: "driver-window",
    aliases: ["חלון נהג", "חלון הנהג", "שמשת נהג", "זכוכית נהג", "driver window", "driver's window"],
    terms: ["driver window", "driver's window", "driver glass", "driving window"],
    exclude: ["switch", "motor", "frame", "trim", "seal", "rubber"],
    he: "חלון הנהג",
    en: "driver window",
  },
  {
    id: "passenger-window",
    aliases: ["חלון נוסע", "חלון הנוסע", "שמשת נוסע", "passenger window"],
    terms: ["passenger window", "passenger glass", "passenger door glass"],
    exclude: ["switch", "motor", "frame", "trim", "seal", "rubber"],
    he: "חלון הנוסע",
    en: "passenger window",
  },
  {
    id: "side-glass",
    aliases: ["שמשת צד", "שמשה צדדית", "חלון צד", "זכוכית צד", "side window", "side glass"],
    terms: ["side window", "side glass"],
    exclude: ["frame", "trim", "seal", "rubber", "curtain"],
    he: "שמשת צד",
    en: "side window",
  },
  {
    id: "front-door",
    aliases: ["דלת קדמית", "דלת כניסה קדמית", "front door", "front passenger door"],
    terms: ["front door", "front passenger door"],
    exclude: ["switch"],
    he: "דלת קדמית",
    en: "front door",
  },
  {
    id: "middle-door",
    aliases: ["דלת אמצעית", "דלת מרכזית", "דלת שניה", "middle door", "center door"],
    terms: ["middle door", "centre door", "center door"],
    he: "דלת אמצעית",
    en: "middle door",
  },
  {
    id: "rear-door",
    aliases: ["דלת אחורית", "rear door", "back door"],
    terms: ["rear door", "back door"],
    he: "דלת אחורית",
    en: "rear door",
  },
  {
    id: "headlamp",
    aliases: ["פנס קדמי", "פנס ראשי", "פנס חזית", "headlamp", "headlight"],
    terms: ["headlamp", "head lamp", "headlight", "front combination lamp"],
    exclude: ["frame", "bracket", "switch"],
    he: "פנס קדמי",
    en: "headlamp",
  },
  {
    id: "rear-lamp",
    aliases: ["פנס אחורי", "פנס זנב", "rear lamp", "tail lamp", "taillight"],
    terms: ["rear lamp", "tail lamp", "taillamp", "taillight", "rear combination lamp"],
    exclude: ["frame", "bracket", "switch"],
    he: "פנס אחורי",
    en: "rear lamp",
  },
  {
    id: "indicator",
    aliases: ["פנס איתות", "וינקר", "איתות", "turn signal", "indicator lamp"],
    terms: ["turn signal", "turn lamp", "indicator lamp", "direction lamp"],
    he: "פנס איתות",
    en: "turn signal",
  },
  {
    id: "mirror",
    aliases: ["מראה", "מראת צד", "מראה חיצונית", "rearview mirror", "side mirror"],
    terms: ["rearview mirror", "rear view mirror", "outside view mirror", "side mirror"],
    exclude: ["switch", "bracket"],
    he: "מראה",
    en: "mirror",
  },
  {
    id: "wiper",
    aliases: ["מגב", "מגבים", "wiper", "windshield wiper"],
    terms: ["wiper", "wiper arm"],
    exclude: ["washer"],
    he: "מגב",
    en: "wiper",
  },
  {
    id: "wiper-motor",
    aliases: ["מנוע מגב", "מנוע המגב", "מנוע מגבים", "מנוע המגבים", "wiper motor"],
    terms: ["wiper motor"],
    exclude: ["bracket", "linkage", "arm", "blade"],
    he: "מנוע המגב",
    en: "wiper motor",
  },
  {
    id: "wiper-arm",
    aliases: ["זרוע מגב", "זרוע המגב", "זרועות מגבים", "wiper arm"],
    terms: ["wiper arm"],
    exclude: ["motor", "linkage"],
    he: "זרוע המגב",
    en: "wiper arm",
  },
  {
    id: "wiper-blade",
    aliases: ["להב מגב", "להב המגב", "גומי מגב", "מגב גומי", "wiper blade"],
    terms: ["wiper blade", "wiper rubber", "wiper strip"],
    exclude: ["motor", "arm", "linkage"],
    he: "להב המגב",
    en: "wiper blade",
  },
  {
    id: "washer-pump",
    aliases: ["משאבת מתזים", "משאבת שפריצר", "מנוע שפריצר", "משאבת מי שמשות", "washer pump"],
    terms: ["washer pump", "windshield washer pump"],
    exclude: ["hose", "tank", "nozzle"],
    he: "משאבת המתזים",
    en: "washer pump",
  },
  {
    id: "brake-pads",
    aliases: ["רפידות בלם", "רפידות בלמים", "רפידות הבלם", "רפידות הבלמים", "רפידה", "brake pad", "brake pads"],
    terms: ["brake pad", "brake lining"],
    exclude: ["sensor", "wear alarm", "alarm"],
    he: "רפידות בלם",
    en: "brake pads",
  },
  {
    id: "brake-disc",
    aliases: ["דיסק בלם", "דיסק הבלם", "צלחת בלם", "צלחת הבלם", "דיסקים לבלמים", "brake disc", "brake disk", "brake rotor"],
    terms: ["brake disc", "brake disk", "brake rotor"],
    he: "דיסק בלם",
    en: "brake disc",
  },
  {
    id: "air-filter",
    aliases: ["מסנן אוויר", "פילטר אוויר", "air filter"],
    terms: ["air filter", "air cleaner element", "air filter element"],
    exclude: ["bracket", "housing"],
    he: "מסנן אוויר",
    en: "air filter",
  },
  {
    id: "oil-filter",
    aliases: ["מסנן שמן", "פילטר שמן", "oil filter"],
    terms: ["oil filter", "lube filter"],
    exclude: ["bracket", "housing"],
    he: "מסנן שמן",
    en: "oil filter",
  },
  {
    id: "fuel-filter",
    aliases: ["מסנן דלק", "פילטר דלק", "סולר", "fuel filter", "diesel filter"],
    terms: ["fuel filter", "diesel filter", "fuel water separator"],
    exclude: ["bracket", "housing"],
    he: "מסנן דלק",
    en: "fuel filter",
  },
  {
    id: "radiator",
    aliases: ["רדיאטור", "מצנן מנוע", "radiator"],
    terms: ["radiator", "engine coolant cooler"],
    exclude: ["hose", "bracket", "mount", "fan shroud"],
    he: "רדיאטור",
    en: "radiator",
  },
  {
    id: "coolant-hose",
    aliases: ["צינור מים", "צינור קירור", "צינור רדיאטור", "coolant hose", "radiator hose"],
    terms: ["coolant hose", "radiator hose", "water hose"],
    he: "צינור מערכת הקירור",
    en: "coolant hose",
  },
  {
    id: "belt",
    aliases: ["רצועה", "רצועת מנוע", "רצועת מזגן", "drive belt", "engine belt"],
    terms: ["drive belt", "engine belt", "compressor belt", "v-belt", "poly-v belt"],
    exclude: ["seat belt"],
    he: "רצועת מנוע",
    en: "drive belt",
  },
  {
    id: "air-compressor",
    aliases: ["מדחס אוויר", "קומפרסור אוויר", "air compressor"],
    terms: ["air compressor"],
    exclude: ["hose", "bracket", "pipe"],
    he: "מדחס אוויר",
    en: "air compressor",
  },
  {
    id: "ac-compressor",
    aliases: ["מדחס מזגן", "קומפרסור מזגן", "מדחס מיזוג", "a/c compressor", "ac compressor"],
    terms: ["a/c compressor", "air conditioning compressor", "ac compressor"],
    exclude: ["bracket", "hose", "belt"],
    he: "מדחס המזגן",
    en: "A/C compressor",
  },
  {
    id: "water-pump",
    aliases: ["משאבת מים", "משאבת קירור", "water pump", "coolant pump"],
    terms: ["water pump", "coolant pump"],
    exclude: ["hose", "bracket"],
    he: "משאבת המים",
    en: "water pump",
  },
  {
    id: "radiator-fan",
    aliases: ["מאוורר רדיאטור", "מאוורר קירור", "ונטה", "radiator fan", "cooling fan"],
    terms: ["radiator fan", "cooling fan", "electronic fan"],
    exclude: ["shroud", "bracket", "guard"],
    he: "מאוורר הקירור",
    en: "radiator fan",
  },
  {
    id: "starter",
    aliases: ["סטרטר", "מתנע", "starter motor", "starter"],
    terms: ["starter motor", "starter"],
    exclude: ["relay", "switch"],
    he: "סטרטר",
    en: "starter motor",
  },
  {
    id: "alternator",
    aliases: ["אלטרנטור", "גנרטור טעינה", "alternator"],
    terms: ["alternator"],
    exclude: ["bracket", "belt"],
    he: "אלטרנטור",
    en: "alternator",
  },
  {
    id: "battery",
    aliases: ["מצבר", "סוללת 24 וולט", "סוללת עזר", "battery"],
    terms: ["battery", "storage battery"],
    exclude: ["traction battery", "power battery", "battery box", "battery cable", "battery bracket"],
    he: "מצבר",
    en: "battery",
  },
  {
    id: "fuse",
    aliases: ["פיוז", "נתיך", "fuse"],
    terms: ["fuse"],
    exclude: ["fuse box", "fuse holder"],
    he: "פיוז",
    en: "fuse",
  },
  {
    id: "steering-wheel",
    aliases: ["הגה", "גלגל הגה", "steering wheel"],
    terms: ["steering wheel"],
    exclude: ["switch"],
    he: "גלגל הגה",
    en: "steering wheel",
  },
  {
    id: "brake-caliper",
    aliases: ["קליפר", "קליפר בלם", "קאליפר", "brake caliper"],
    terms: ["brake caliper", "disc brake caliper", "caliper assembly"],
    exclude: ["bracket", "repair kit"],
    he: "קליפר בלם",
    en: "brake caliper",
  },
  {
    id: "air-spring",
    aliases: ["בלון אוויר", "כרית מתלה", "כרית אוויר למתלה", "air spring", "suspension air bag"],
    terms: ["air spring", "suspension air bag", "air bag assembly"],
    exclude: ["seat", "safety", "curtain"],
    he: "כרית אוויר למתלה",
    en: "air spring",
  },
  {
    id: "front-bumper",
    aliases: ["טמבון קדמי", "פגוש קדמי", "front bumper"],
    terms: ["front bumper"],
    exclude: ["bracket", "trim", "lamp"],
    he: "פגוש קדמי",
    en: "front bumper",
  },
  {
    id: "rear-bumper",
    aliases: ["טמבון אחורי", "פגוש אחורי", "rear bumper"],
    terms: ["rear bumper"],
    exclude: ["bracket", "trim", "lamp"],
    he: "פגוש אחורי",
    en: "rear bumper",
  },
  {
    id: "driver-seat",
    aliases: ["מושב נהג", "כיסא נהג", "driver seat", "driver's seat"],
    terms: ["driver seat", "driver's seat"],
    exclude: ["belt", "cover", "switch"],
    he: "מושב נהג",
    en: "driver seat",
  },
  {
    id: "door-motor",
    aliases: ["מנוע דלת", "מנוע הדלת", "door motor", "door actuator"],
    terms: ["door motor", "door actuator", "door driving motor"],
    exclude: ["wiper", "window"],
    he: "מנוע הדלת",
    en: "door motor",
  },
  {
    id: "door-handle",
    aliases: ["ידית דלת", "ידית פתיחת דלת", "door handle"],
    terms: ["door handle", "opening handle"],
    exclude: ["window", "handrail"],
    he: "ידית הדלת",
    en: "door handle",
  },
  {
    id: "floor-mat",
    aliases: ["שטיח", "שטיח רצפה", "שטיחון", "floor mat", "floor carpet"],
    terms: ["floor mat", "floor carpet", "rubber mat"],
    he: "שטיח רצפה",
    en: "floor mat",
  },
  {
    id: "roof-glass",
    aliases: ["זכוכית גג", "גג פנורמי", "חלון גג", "roof glass", "sunroof glass"],
    terms: ["roof glass", "sunroof glass", "skylight glass"],
    exclude: ["frame", "seal", "motor", "switch"],
    he: "זכוכית גג",
    en: "roof glass",
  },
];

const findSmartSearchRule = (query: string) => {
  const normalizedQuery = query.toLowerCase().replace(/[״"'’]/g, "").replace(/\s+/g, " ").trim();
  return SMART_SEARCH_RULES
    .flatMap((rule) => rule.aliases.map((alias) => ({ rule, alias: alias.toLowerCase() })))
    .filter(({ alias }) => normalizedQuery.includes(alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.rule;
};

const matchesSmartSearchRule = (part: Part, occurrence: Occurrence, rule: SmartSearchRule) => {
  const primaryDescription = [
    part.description,
    part.descriptionChinese,
  ].filter(Boolean).join(" ");
  const description = /[A-Z]/i.test(primaryDescription)
    ? primaryDescription
    : [primaryDescription, occurrence.description, occurrence.notes].filter(Boolean).join(" ");
  const matchesTerm = rule.terms.some((term) => matchesSearch(description, term));
  const excluded = rule.exclude?.some((term) => matchesSearch(description, term)) ?? false;
  return matchesTerm && !excluded;
};

const CATALOG_QUERY_TERMS: { aliases: string[]; term: string }[] = [
  { aliases: ["חיישן", "סנסור"], term: "sensor" },
  { aliases: ["צינור", "צינורית"], term: "hose pipe tube" },
  { aliases: ["אטם", "אטימה", "גומייה", "גומיה"], term: "gasket seal rubber" },
  { aliases: ["מיסב", "לאגר"], term: "bearing" },
  { aliases: ["מתג", "סוויץ"], term: "switch" },
  { aliases: ["מחבר", "קונקטור"], term: "connector" },
  { aliases: ["צמת חשמל", "צמה"], term: "wiring harness" },
  { aliases: ["שסתום"], term: "valve" },
  { aliases: ["בקר", "יחידת בקרה", "מודול"], term: "controller control module ecu" },
  { aliases: ["תושבת"], term: "bracket" },
  { aliases: ["מסנן", "פילטר"], term: "filter" },
  { aliases: ["משאבה"], term: "pump" },
  { aliases: ["מנוע"], term: "motor engine" },
  { aliases: ["קמינס", "קומינס"], term: "cummins l9 x11" },
  { aliases: ["רצועה"], term: "belt" },
  { aliases: ["ידית"], term: "handle lever" },
  { aliases: ["זרוע"], term: "arm lever" },
  { aliases: ["כיסוי", "מכסה"], term: "cover cap lid" },
  { aliases: ["בורג"], term: "bolt screw" },
  { aliases: ["אום"], term: "nut" },
  { aliases: ["ממסר", "ריליי"], term: "relay" },
  { aliases: ["בולם", "בולם זעזועים"], term: "shock absorber damper" },
  { aliases: ["ערכת תיקון", "קיט תיקון"], term: "repair kit" },
  { aliases: ["מכלול"], term: "assembly assy" },
  { aliases: ["פנס"], term: "lamp" },
  { aliases: ["קדמי", "קדמית", "קדמיים"], term: "front" },
  { aliases: ["אחורי", "אחורית", "אחוריים"], term: "rear" },
  { aliases: ["שמאל", "שמאלי", "שמאלית"], term: "left" },
  { aliases: ["ימין", "ימני", "ימנית"], term: "right" },
  { aliases: ["דלת"], term: "door" },
  { aliases: ["נהג"], term: "driver" },
  { aliases: ["הגה", "היגוי"], term: "steering" },
  { aliases: ["בלם", "בלמים"], term: "brake" },
  { aliases: ["אוויר"], term: "air" },
  { aliases: ["מים", "קירור"], term: "coolant" },
  { aliases: ["שמן"], term: "oil" },
  { aliases: ["דלק", "סולר"], term: "fuel" },
  { aliases: ["חשמל", "חשמלי"], term: "electric" },
  { aliases: ["גג"], term: "roof" },
  { aliases: ["זכוכית", "שמשה"], term: "glass" },
];

const isLeftDescription = (value: string) => /\bleft\b|\blh\b|left-hand|\bl\.h\b/i.test(value);
const isRightDescription = (value: string) => /\bright\b|\brh\b|right-hand|\br\.h\b/i.test(value);

function categoryFor(part: Part, occurrence: Occurrence): CategoryId {
  const code = occurrence.assemblyCode.toUpperCase();
  const token = code.match(/-([A-Z]{2})-/)?.[1] ?? "";
  const prefix = Number.parseInt(part.partNumber.slice(0, 4), 10);
  const words = `${occurrence.assembly} ${part.description}`.toLowerCase();

  if (token === "HA" || (prefix >= 8100 && prefix < 8200) || /air conditioning|a\/c|heater|heating|defrost/.test(words)) return "hvac";
  if (token === "BS" || (prefix >= 3500 && prefix < 3600) || /brake|ebs|air reservoir/.test(words)) return "brakes";
  if (token === "SS" || (prefix >= 3400 && prefix < 3500) || /steering/.test(words)) return "steering";
  if (["FA", "RA", "SP", "WS"].includes(token) || (prefix >= 2400 && prefix < 3200) || /axle|suspension|wheel end|wheel assembly/.test(words)) return "axles";
  if (["GB", "PS"].includes(token) || (prefix >= 1700 && prefix < 2400) || /transmission|gearbox|drive shaft/.test(words)) return "drive";
  if (["EN", "ES", "CS", "MS"].includes(token) || (prefix >= 1000 && prefix < 1700) || /engine|cooling system|radiator|fuel system/.test(words)) return "powertrain";
  if (["EL", "DS"].includes(token) || (prefix >= 3700 && prefix < 4000) || /electric|battery|sensor|harness|controller/.test(words)) return "electrical";
  if (["BC", "BA", "CA"].includes(token) || (prefix >= 5000 && prefix < 6100) || /door|window|mirror|wiper|body|bumper/.test(words)) return "body";
  if (["IT", "VT"].includes(token) || (prefix >= 6100 && prefix < 9000) || /seat|interior|dashboard|handrail|curtain/.test(words)) return "interior";
  return "other";
}

function categoryForGroup(code: string, fallback: CategoryId): CategoryId {
  const token = code.toUpperCase().match(/-([A-Z]{2})-\d+$/)?.[1] ?? "";
  if (["EN", "ES", "CS", "MS"].includes(token)) return "powertrain";
  if (["DM", "GB", "PS", "TS"].includes(token)) return "drive";
  if (["FA", "RA", "SP", "WS"].includes(token)) return "axles";
  if (token === "SS") return "steering";
  if (token === "BS") return "brakes";
  if (["EL", "PO"].includes(token)) return "electrical";
  if (["BA", "BC", "CA"].includes(token)) return "body";
  if (["IT", "VT"].includes(token)) return "interior";
  if (token === "HA") return "hvac";
  return fallback;
}

const SMART_QUERY_STOP_WORDS = new Set([
  "אני", "צריך", "צריכה", "מחפש", "מחפשת", "רוצה", "תראה", "תציג", "מצא", "לי", "את", "של", "על", "עם", "בלי", "בבקשה", "איפה", "היכן", "מה", "איזה", "איזו", "יש", "חלק", "חלקים", "מק״ט", "מקט",
  "I", "NEED", "LOOKING", "FOR", "FIND", "SHOW", "ME", "THE", "A", "AN", "PLEASE", "WHERE", "WHAT", "WHICH", "PART", "PARTS", "NUMBER",
]);

const normalizeSmartText = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0591-\u05C7]/g, "")
  .replace(/[ךםןףץ]/g, (letter) => ({ "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" }[letter] ?? letter))
  .replace(/[״"'’`]/g, "")
  .replace(/[^A-Za-z0-9\u0590-\u05FF\u4E00-\u9FFF-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toUpperCase();

const smartTokens = (value: string) => normalizeSmartText(value)
  .split(/[\s-]+/)
  .filter((token) => token.length > 1);

const smartTokenVariants = (token: string) => {
  const variants = new Set([token]);
  if (/^[\u0590-\u05FF]+$/.test(token) && token.length > 4 && /^[אבדהולמש]/.test(token)) variants.add(token.slice(1));
  if (/^[A-Z]+$/.test(token) && token.length > 4 && token.endsWith("S")) variants.add(token.slice(0, -1));
  if (/^[A-Z]+$/.test(token) && token.length > 5 && token.endsWith("ES")) variants.add(token.slice(0, -2));
  return [...variants];
};

const levenshteinDistance = (left: string, right: string) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

const smartTokenMatchStrength = (candidateTokens: Set<string>, queryToken: string, allowFuzzy = false) => {
  const variants = smartTokenVariants(queryToken);
  if (variants.some((variant) => candidateTokens.has(variant))) return 3;
  for (const variant of variants) {
    if (variant.length < 4) continue;
    for (const candidate of candidateTokens) {
      if (candidate.startsWith(variant) || variant.startsWith(candidate)) return 2;
    }
  }
  if (allowFuzzy) {
    for (const variant of variants) {
      if (variant.length < 4) continue;
      const allowedDistance = variant.length >= 6 ? 2 : 1;
      for (const candidate of candidateTokens) {
        if (candidate[0] !== variant[0] || Math.abs(candidate.length - variant.length) > allowedDistance) continue;
        if (levenshteinDistance(candidate, variant) <= allowedDistance) return 1;
      }
    }
  }
  return 0;
};

const analyzeSmartQuery = (query: string): SmartQueryAnalysis => {
  const normalized = normalizeSmartText(query);
  const rule = findSmartSearchRule(query);
  const category = CATEGORIES.find((item) => item.aliases.some((alias) => normalized.includes(normalizeSmartText(alias))))?.id;
  const side = /\b(LEFT|LH)\b|שמאל/.test(normalized) ? "left" as const
    : /\b(RIGHT|RH)\b|ימינ|ימין/.test(normalized) ? "right" as const
      : undefined;
  const year = normalized.match(/\b20\d{2}\b/)?.[0];
  const models = [...new Set((query.toUpperCase().match(/\bLCK[A-Z0-9]+\b/g) ?? []))];
  const position = query.match(/(?:מס(?:פר|׳|')?|מיקום|POSITION|POS\.?)[\s:#-]*(\d{1,3})/i)?.[1];
  const partNumber = query.toUpperCase().match(/[A-Z0-9]{2,}(?:-[A-Z0-9]+){1,}/)?.[0];
  const rawTokens = smartTokens(query).filter((token) => !SMART_QUERY_STOP_WORDS.has(token) && token !== year && !models.includes(token));
  const matchedSemanticTerms = CATALOG_QUERY_TERMS
    .flatMap((item) => {
      const matchedAlias = item.aliases.find((alias) => normalized.includes(normalizeSmartText(alias)));
      return matchedAlias ? [{ he: matchedAlias, en: item.term.split(" ")[0], tokens: smartTokens(item.term) }] : [];
    });
  const semanticGroups = matchedSemanticTerms.filter((group, index, groups) => groups.findIndex((item) => item.tokens.join("|") === group.tokens.join("|")) === index);
  const translatedTokens = [...new Set(semanticGroups.flatMap((group) => group.tokens))];
  const categoryMeta = CATEGORIES.find((item) => item.id === category);
  const identifiesCummins = translatedTokens.includes("CUMMINS");
  const understoodHe = [
    rule?.he || rawTokens.slice(0, 5).join(" ").toLowerCase(),
    rule && categoryMeta ? categoryMeta.he : "",
    identifiesCummins ? "Cummins" : "",
    side === "left" ? "צד שמאל" : side === "right" ? "צד ימין" : "",
    position ? `מיקום ${position}` : "",
    ...models,
    year ?? "",
  ].filter(Boolean).join(" · ");
  const understoodEn = [
    rule?.en || (translatedTokens.length ? translatedTokens.slice(0, 5).join(" ").toLowerCase() : rawTokens.slice(0, 5).join(" ").toLowerCase()),
    rule && categoryMeta ? categoryMeta.en : "",
    identifiesCummins ? "Cummins" : "",
    side === "left" ? "left side" : side === "right" ? "right side" : "",
    position ? `position ${position}` : "",
    ...models,
    year ?? "",
  ].filter(Boolean).join(" · ");
  return {
    cleaned: normalized,
    rawTokens,
    translatedTokens,
    semanticGroups,
    partNumber,
    rule,
    category,
    side,
    year,
    models,
    position,
    understoodHe: understoodHe || query.trim(),
    understoodEn: understoodEn || query.trim(),
  };
};

const smartConfidenceLabel = (confidence: SmartMatchConfidence, he: boolean) => {
  if (confidence === "strong") return he ? "התאמה חזקה" : "Strong match";
  if (confidence === "good") return he ? "התאמה טובה" : "Good match";
  return he ? "התאמה אפשרית" : "Possible match";
};

const rankSmartPart = (part: Part, analysis: SmartQueryAnalysis, occurrences = part.occurrences) => {
  if (!occurrences.length) return null;
  const descriptions = [part.descriptionHebrew, part.description, part.descriptionChinese, ...occurrences.map((item) => item.description)].filter(Boolean).join(" ");
  const assemblies = occurrences.flatMap((item) => [item.assembly, item.assemblyCode, item.notes]).filter(Boolean).join(" ");
  const metadata = [...part.models, ...part.years, ...occurrences.flatMap((item) => [item.model, item.year, item.engine, item.vehicleType])].filter(Boolean).join(" ");
  const descriptionNormalized = normalizeSmartText(descriptions);
  const assemblyNormalized = normalizeSmartText(assemblies);
  const metadataNormalized = normalizeSmartText(metadata);
  const descriptionTokens = new Set(smartTokens(descriptions));
  const assemblyTokens = new Set(smartTokens(assemblies));
  const metadataTokens = new Set(smartTokens(metadata));
  const allTokens = new Set([...descriptionTokens, ...assemblyTokens, ...metadataTokens, ...smartTokens(part.partNumber)]);
  let score = 0;
  const detailsHe: string[] = [];
  const detailsEn: string[] = [];
  const addReason = (heReason: string, enReason: string) => {
    if (!detailsHe.includes(heReason)) detailsHe.push(heReason);
    if (!detailsEn.includes(enReason)) detailsEn.push(enReason);
  };

  if (analysis.partNumber) {
    const candidatePartNumber = normalize(part.partNumber);
    const requestedPartNumber = normalize(analysis.partNumber);
    if (candidatePartNumber === requestedPartNumber) {
      score += 140;
      addReason("מק״ט מדויק", "Exact part number");
    } else if (candidatePartNumber.includes(requestedPartNumber) || requestedPartNumber.includes(candidatePartNumber)) {
      score += 88;
      addReason("התאמה למק״ט חלקי", "Partial part-number match");
    }
  }

  const meaningfulPhrase = analysis.cleaned
    .split(" ")
    .filter((token) => !SMART_QUERY_STOP_WORDS.has(token))
    .join(" ");
  if (meaningfulPhrase.length >= 3 && descriptionNormalized === meaningfulPhrase) {
    score += 104;
    addReason("התאמה ישירה לתיאור החלק", "Direct description match");
  } else if (meaningfulPhrase.length >= 3 && descriptionNormalized.includes(meaningfulPhrase)) {
    score += 76;
    addReason("הביטוי מופיע בתיאור החלק", "The phrase appears in the part description");
  } else if (meaningfulPhrase.length >= 3 && assemblyNormalized.includes(meaningfulPhrase)) {
    score += 52;
    addReason("הביטוי מופיע בשם המכלול", "The phrase appears in the assembly name");
  }

  const ruleMatched = Boolean(analysis.rule && occurrences.some((occurrence) => matchesSmartSearchRule(part, occurrence, analysis.rule!)));
  if (ruleMatched && analysis.rule) {
    score += 72;
    addReason(`זוהה החלק „${analysis.rule.he}”`, `Recognized as “${analysis.rule.en}”`);
  }

  const matchedRawTokens: string[] = [];
  analysis.rawTokens.forEach((token) => {
    const allowFuzzy = !analysis.rule && !analysis.translatedTokens.length && analysis.rawTokens.length <= 2;
    const strength = smartTokenMatchStrength(allTokens, token, allowFuzzy);
    if (!strength) return;
    matchedRawTokens.push(token);
    score += strength === 3 ? 11 : strength === 2 ? 8 : 5;
  });
  if (analysis.rawTokens.length && matchedRawTokens.length === analysis.rawTokens.length) {
    score += 18;
    if (!analysis.rule) addReason("כל מילות החיפוש קיבלו התאמה", "All search terms matched");
  } else if (matchedRawTokens.length) {
    addReason("נמצאה התאמה לחלק ממילות החיפוש", "Some search terms matched");
  }

  const categoryMatched = analysis.category
    ? occurrences.some((occurrence) => categoryFor(part, occurrence) === analysis.category)
    : false;
  const matchedSemanticGroups = analysis.semanticGroups.flatMap((group) => {
    const primaryToken = group.tokens.find((token) => smartTokenMatchStrength(descriptionTokens, token) >= 2);
    const metadataToken = group.tokens.find((token) => smartTokenMatchStrength(metadataTokens, token) >= 2);
    const assemblyToken = group.tokens.find((token) => smartTokenMatchStrength(assemblyTokens, token) >= 2);
    const matchedToken = primaryToken
      || metadataToken
      || assemblyToken;
    const weight = primaryToken ? 32 : metadataToken ? 20 : 12;
    return matchedToken
      ? [{ group, matchedToken, weight }]
      : [];
  });
  if (matchedSemanticGroups.length) {
    score += matchedSemanticGroups.reduce((sum, item) => sum + item.weight, 0);
    addReason(
      `תואם למונחי הקטלוג: ${matchedSemanticGroups.slice(0, 3).map((item) => item.matchedToken).join(", ").toLowerCase()}`,
      `Catalog terms matched: ${matchedSemanticGroups.slice(0, 3).map((item) => item.matchedToken).join(", ").toLowerCase()}`,
    );
  }
  const missingSemanticGroups = analysis.semanticGroups.length - matchedSemanticGroups.length;
  if (analysis.semanticGroups.length > 1 && missingSemanticGroups > 0) score -= missingSemanticGroups * 64;
  if (analysis.semanticGroups.length > 1 && missingSemanticGroups === 0) score += 24;
  if (analysis.rule && !ruleMatched) return null;

  if (analysis.category) {
    if (categoryMatched) {
      score += 28;
      const categoryMeta = CATEGORIES.find((item) => item.id === analysis.category);
      if (categoryMeta) addReason(`שייך למערכת „${categoryMeta.he}”`, `Belongs to “${categoryMeta.en}”`);
    } else score -= 58;
  }

  if (analysis.side) {
    const combined = `${descriptions} ${assemblies}`;
    const matchesSide = analysis.side === "left" ? isLeftDescription(combined) : isRightDescription(combined);
    const matchesOpposite = analysis.side === "left" ? isRightDescription(combined) : isLeftDescription(combined);
    if (matchesSide) {
      score += 22;
      addReason(analysis.side === "left" ? "מסומן כצד שמאל" : "מסומן כצד ימין", analysis.side === "left" ? "Marked left side" : "Marked right side");
    } else if (matchesOpposite) score -= 90;
  }

  if (analysis.position) {
    const positionMatch = occurrences.some((occurrence) => occurrence.position?.trim() === analysis.position);
    if (positionMatch) {
      score += 92;
      addReason(`מיקום ${analysis.position} בשרטוט`, `Diagram position ${analysis.position}`);
    } else score -= 18;
  }

  if (analysis.year) {
    const yearMatch = part.years.includes(analysis.year) || occurrences.some((occurrence) => occurrence.year === analysis.year);
    if (yearMatch) {
      score += 18;
      addReason(`מופיע בקטלוג שנת ${analysis.year}`, `Appears in a ${analysis.year} catalog`);
    } else score -= 10;
  }

  if (analysis.models.length) {
    const modelMatch = analysis.models.some((model) => part.models.some((partModel) => partModel.toUpperCase() === model) || metadataNormalized.includes(model));
    if (modelMatch) {
      score += 34;
      addReason(`מתאים לדגם ${analysis.models.join(" / ")}`, `Matches model ${analysis.models.join(" / ")}`);
    } else score -= 24;
  }

  if (score < 22) return null;

  const bestOccurrence = [...occurrences].sort((left, right) => {
    const occurrenceScore = (occurrence: Occurrence) => {
      const occurrenceText = new Set(smartTokens(`${occurrence.description} ${occurrence.assembly} ${occurrence.notes}`));
      let value = occurrence.position ? 2 : 0;
      if (analysis.position && occurrence.position?.trim() === analysis.position) value += 30;
      if (analysis.side === "left" && isLeftDescription(`${occurrence.description} ${occurrence.assembly}`)) value += 12;
      if (analysis.side === "right" && isRightDescription(`${occurrence.description} ${occurrence.assembly}`)) value += 12;
      value += analysis.translatedTokens.filter((token) => smartTokenMatchStrength(occurrenceText, token) >= 2).length * 2;
      return value;
    };
    return occurrenceScore(right) - occurrenceScore(left);
  })[0];
  const confidence: SmartMatchConfidence = score >= 82 ? "strong" : score >= 48 ? "good" : "possible";
  const match: SmartMatch = {
    score,
    confidence,
    reasonHe: detailsHe[0] ?? "התאמה לפי נתוני הקטלוג",
    reasonEn: detailsEn[0] ?? "Matched from catalog data",
    detailsHe: detailsHe.slice(0, 3),
    detailsEn: detailsEn.slice(0, 3),
    understoodHe: analysis.understoodHe,
    understoodEn: analysis.understoodEn,
  };
  return { part, occurrence: bestOccurrence, occurrenceCount: occurrences.length, match };
};

const rankSmartParts = (parts: Part[], query: string, occurrenceFilter?: (occurrence: Occurrence) => boolean) => {
  const analysis = analyzeSmartQuery(query);
  const ranked = parts.flatMap((part) => {
    const occurrences = occurrenceFilter ? part.occurrences.filter(occurrenceFilter) : part.occurrences;
    const result = rankSmartPart(part, analysis, occurrences);
    return result ? [result] : [];
  }).sort((left, right) => right.match.score - left.match.score
    || left.part.partNumber.localeCompare(right.part.partNumber));
  return { analysis, ranked };
};

export default function Home() {
  const [language, setLanguage] = useState<"he" | "en">("he");
  const [data, setData] = useState<Data | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoadError, setDataLoadError] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [mode, setMode] = useState<SearchMode>("part");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<Part | null>(null);
  const [model, setModel] = useState("all");
  const [vinReturnState, setVinReturnState] = useState<VinBrowseState | null>(null);
  const [vinRestoreState, setVinRestoreState] = useState<VinBrowseState | null>(null);
  const [catalogReturnState, setCatalogReturnState] = useState<CatalogBrowseState | null>(null);
  const [catalogRestoreState, setCatalogRestoreState] = useState<CatalogBrowseState | null>(null);
  const [browseCategoryIntent, setBrowseCategoryIntent] = useState<CategoryId | null>(null);
  const [photosReturn, setPhotosReturn] = useState(false);
  const pendingScrollY = useRef<number | null>(null);
  const pendingCatalogScrollY = useRef<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const he = language === "he";

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/parts-data.json", { cache: "no-cache", signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error(`catalog-${res.status}`);
        return res.json() as Promise<Data>;
      }),
      fetch("/hebrew-descriptions.json", { cache: "no-cache", signal: controller.signal })
        .then((res) => res.ok ? res.json() as Promise<Record<string, string>> : {})
        .catch(() => ({})),
    ]).then(([catalogData, hebrewDescriptions]) => {
      setData({
        ...catalogData,
        parts: catalogData.parts.map((part) => ({
          ...part,
          descriptionHebrew: hebrewDescriptions[part.partNumber],
        })),
      });
      setDataLoadError(false);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDataLoadError(true);
    }).finally(() => setDataLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!data) return;
    const adminPart = new URLSearchParams(window.location.search).get("adminPart");
    if (!adminPart) return;

    const cleanPart = adminPart.trim().toUpperCase();
    if (!data.parts.some((part) => part.partNumber === cleanPart)) return;
    const timer = window.setTimeout(() => {
      setMode("part");
      setQuery(cleanPart);
      setSubmitted(cleanPart);
      setHasSearched(true);
      setSelected(null);
      setModel("all");
      setPhotosReturn(false);
      window.history.replaceState(
        { ztCatalogView: "part", partNumber: cleanPart } satisfies CatalogHistoryState,
        "",
        appUrl(`/part/${encodeURIComponent(cleanPart)}`, language),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, language]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const applyUrlRoute = () => {
      const route = parseAppRoute();
      setLanguage(route.language);
      setMode(route.mode);
      setQuery(route.query);
      setSubmitted(route.submitted);
      setHasSearched(Boolean(route.submitted));
      setSearchError(route.submitted ? searchValidationMessage(route.mode, route.submitted, route.language === "he") : "");
      setSearchLoading(false);
      setSelected(null);
      setModel("all");
      setVinReturnState(null);
      setVinRestoreState(null);
      setCatalogReturnState(null);
      setCatalogRestoreState(route.browseState);
      setBrowseCategoryIntent(route.browseCategory ?? (route.browseState?.category && route.browseState.category !== "all" ? route.browseState.category : null));
      setPhotosReturn(false);
    };

    const applyHistoryState = (historyState: CatalogHistoryState | null) => {
      if (historyState?.ztCatalogView === "vin") {
        const saved = historyState.vinState;
        pendingScrollY.current = saved.scrollY;
        setMode("vin");
        setQuery(saved.vin);
        setSubmitted(saved.vin);
        setHasSearched(true);
        setSearchError("");
        setSelected(null);
        setModel("all");
        setVinReturnState(null);
        setVinRestoreState(saved);
        setPhotosReturn(false);
      } else if (historyState?.ztCatalogView === "part") {
        setMode("part");
        setQuery(historyState.partNumber);
        setSubmitted(historyState.partNumber);
        setHasSearched(true);
        setSearchError("");
        setSelected(null);
        setModel("all");
        setVinRestoreState(null);
        setVinReturnState(historyState.vinState ?? null);
        setPhotosReturn(Boolean(historyState.fromPhotos));
        window.scrollTo({ top: 72, behavior: "auto" });
      } else if (historyState?.ztCatalogView === "search") {
        setMode(historyState.searchMode);
        setQuery(historyState.searchQuery);
        setSubmitted(historyState.searchQuery);
        setHasSearched(true);
        setSearchError("");
        setSelected(null);
        setModel("all");
        setVinReturnState(null);
        setVinRestoreState(null);
        setCatalogReturnState(null);
        setCatalogRestoreState(null);
        setPhotosReturn(false);
      } else if (historyState?.ztCatalogView === "browse") {
        const saved = historyState.browseState;
        pendingCatalogScrollY.current = saved.scrollY;
        setMode("browse");
        setQuery("");
        setSubmitted("");
        setHasSearched(false);
        setSearchError("");
        setSelected(null);
        setModel("all");
        setVinReturnState(null);
        setVinRestoreState(null);
        setCatalogReturnState(null);
        setCatalogRestoreState(saved);
        setPhotosReturn(false);
      } else if (historyState?.ztCatalogView === "catalog-part") {
        setMode("part");
        setQuery(historyState.partNumber);
        setSubmitted(historyState.partNumber);
        setHasSearched(true);
        setSearchError("");
        setSelected(null);
        setModel("all");
        setVinReturnState(null);
        setVinRestoreState(null);
        setCatalogRestoreState(null);
        setCatalogReturnState(historyState.browseState);
        setPhotosReturn(false);
        window.scrollTo({ top: 72, behavior: "auto" });
      } else if (historyState?.ztCatalogView === "photos") {
        setMode("photos");
        setQuery("");
        setSubmitted("");
        setHasSearched(false);
        setSearchError("");
        setSelected(null);
        setVinReturnState(null);
        setVinRestoreState(null);
        setCatalogReturnState(null);
        setCatalogRestoreState(null);
        setPhotosReturn(false);
      } else {
        applyUrlRoute();
      }
      setLanguage(parseAppRoute().language);
    };

    const handlePopState = (event: PopStateEvent) => {
      applyHistoryState(event.state as CatalogHistoryState | null);
    };

    const timer = window.setTimeout(() => {
      applyUrlRoute();
      setRouteReady(true);
    }, 0);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.clearTimeout(timer);
      window.history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = he ? "rtl" : "ltr";
  }, [he, language]);

  useEffect(() => () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
  }, []);

  useEffect(() => {
    if (mode !== "vin" || !submitted || !data || pendingScrollY.current === null) return;
    const scrollY = pendingScrollY.current;
    pendingScrollY.current = null;
    const timer = window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 50);
    return () => window.clearTimeout(timer);
  }, [mode, submitted, data, vinRestoreState]);

  useEffect(() => {
    if (mode !== "browse" || !data || !catalogRestoreState || pendingCatalogScrollY.current === null) return;
    const scrollY = pendingCatalogScrollY.current;
    pendingCatalogScrollY.current = null;
    const timer = window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 50);
    return () => window.clearTimeout(timer);
  }, [mode, data, catalogRestoreState]);

  const models = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.parts.flatMap((part) => part.models))].sort();
  }, [data]);

  const partIndex = useMemo(() => new Map(data?.parts.map((part) => [part.partNumber, part]) ?? []), [data]);
  const catalogVins = useMemo(() => new Map(data?.catalogs.map((catalog) => [catalog.catalog, catalog.vinNumbers ?? []]) ?? []), [data]);
  const vinCount = useMemo(() => data?.catalogs.reduce((sum, catalog) => sum + (catalog.vinNumbers?.length ?? 0), 0) ?? 0, [data]);
  const contextualCatalog = useMemo(() => {
    if (!data) return undefined;
    if (catalogReturnState?.catalog) return catalogReturnState.catalog;
    if (!vinReturnState?.vin) return undefined;
    const vin = normalizeVin(vinReturnState.vin);
    return data.catalogs.find((catalog) => catalog.vinNumbers?.some((item) => normalizeVin(item) === vin))?.catalog;
  }, [catalogReturnState, data, vinReturnState]);
  const featuredCatalogs = useMemo(() => data
    ? [...data.catalogs]
      .sort((a, b) => (b.parts ?? 0) - (a.parts ?? 0))
      .slice(0, 3)
    : [], [data]);
  const homeCategoryCounts = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    if (!data) return counts;
    data.parts.forEach((part) => {
      const categories = new Set(part.occurrences.map((occurrence) => categoryFor(part, occurrence)));
      categories.forEach((category) => counts.set(category, (counts.get(category) ?? 0) + 1));
    });
    return counts;
  }, [data]);
  const isHome = routeReady && mode === "part" && !hasSearched && !submitted;

  const rankedResults = useMemo(() => {
    if (!data || !submitted || (mode !== "part" && mode !== "description")) return { analysis: null as SmartQueryAnalysis | null, ranked: [] as NonNullable<ReturnType<typeof rankSmartPart>>[] };
    const scopedParts = data.parts.filter((part) => model === "all" || part.models.includes(model));
    if (mode === "description") {
      const smart = rankSmartParts(scopedParts, submitted);
      return { analysis: smart.analysis, ranked: smart.ranked.slice(0, 50) };
    }
    const q = normalize(submitted);
    const analysis = analyzeSmartQuery(submitted);
    const ranked = scopedParts
      .filter((part) => normalize(part.partNumber).includes(q))
      .sort((left, right) => {
        const exactLeft = normalize(left.partNumber) === q ? 0 : 1;
        const exactRight = normalize(right.partNumber) === q ? 0 : 1;
        return exactLeft - exactRight || left.partNumber.localeCompare(right.partNumber);
      })
      .slice(0, 50)
      .map((part) => {
        const exact = normalize(part.partNumber) === q;
        const match: SmartMatch = {
          score: exact ? 140 : 88,
          confidence: exact ? "strong" : "good",
          reasonHe: exact ? "מק״ט מדויק" : "התאמה למק״ט חלקי",
          reasonEn: exact ? "Exact part number" : "Partial part-number match",
          detailsHe: [exact ? "מק״ט מדויק" : "התאמה למק״ט חלקי"],
          detailsEn: [exact ? "Exact part number" : "Partial part-number match"],
          understoodHe: submitted,
          understoodEn: submitted,
        };
        return { part, occurrence: part.occurrences.find((item) => item.position) ?? part.occurrences[0], occurrenceCount: part.occurrences.length, match };
      });
    return { analysis, ranked };
  }, [data, submitted, model, mode]);
  const results = useMemo(() => rankedResults.ranked.map((result) => result.part), [rankedResults]);
  const resultMatchByPart = useMemo(() => new Map(rankedResults.ranked.map((result) => [result.part.partNumber, result.match])), [rankedResults]);

  const vinCatalog = useMemo(() => {
    if (!data || !submitted || mode !== "vin") return null;
    const vin = normalizeVin(submitted);
    return data.catalogs.find((catalog) => catalog.vinNumbers?.some((item) => normalizeVin(item) === vin)) ?? null;
  }, [data, submitted, mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(results[0] ?? null);
  }, [submitted, model, results]);

  useEffect(() => {
    if (!routeReady) return;
    if (selected) {
      document.title = `${selected.partNumber} · ${displayPartDescription(selected, he, "Zhongtong part")}`;
      return;
    }
    if (mode === "vin" && submitted) {
      document.title = `${submitted} · ${he ? "קטלוג לפי שלדה" : "VIN catalog"}`;
      return;
    }
    document.title = he ? "קטלוג חלפי Zhongtong חכם" : "Zhongtong Smart Parts Catalog";
  }, [he, mode, routeReady, selected, submitted]);

  const search = (value = query) => {
    const validationError = searchValidationMessage(mode, value, he);
    if (validationError) {
      setSearchError(validationError);
      setSearchLoading(false);
      setHasSearched(true);
      return;
    }

    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    const cleanValue = mode === "vin" ? normalizeVin(value) : value.trim();
    const exactPart = mode === "part" ? partIndex.get(cleanValue.toUpperCase()) : undefined;
    setSearchError("");
    setSearchLoading(true);
    setHasSearched(true);
    setQuery(cleanValue);
    setSubmitted("");
    setSelected(null);
    setModel("all");
    setCatalogRestoreState(null);
    setCatalogReturnState(null);
    if (mode === "vin") {
      setVinRestoreState(null);
      setVinReturnState(null);
    }

    searchTimerRef.current = window.setTimeout(() => {
      setSubmitted(cleanValue);
      setSearchLoading(false);
      searchTimerRef.current = null;

      if (mode === "vin") {
        const vinState: VinBrowseState = { vin: cleanValue, category: "all", textFilter: "", visibleCount: 80, assistantQuery: "", messages: [], scrollY: 0 };
        window.history.pushState(
          { ztCatalogView: "vin", vinState } satisfies CatalogHistoryState,
          "",
          appUrl(`/vin/${encodeURIComponent(cleanValue)}`, language),
        );
        return;
      }

      if (exactPart) {
        window.history.pushState(
          { ztCatalogView: "part", partNumber: exactPart.partNumber } satisfies CatalogHistoryState,
          "",
          appUrl(`/part/${encodeURIComponent(exactPart.partNumber)}`, language),
        );
        return;
      }

      const searchMode = mode === "description" ? "description" : "part";
      window.history.pushState(
        { ztCatalogView: "search", searchMode, searchQuery: cleanValue } satisfies CatalogHistoryState,
        "",
        appUrl(`/search/${searchMode}`, language, { q: cleanValue }),
      );
    }, 180);
  };

  const clearSearch = () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSearchLoading(false);
    setSearchError("");
    setSelected(null);
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(null);
    window.history.pushState(null, "", appUrl("/", language));
  };

  const changeLanguage = () => {
    const nextLanguage = he ? "en" : "he";
    const currentUrl = new URL(window.location.href);
    if (nextLanguage === "en") currentUrl.searchParams.set("lang", "en");
    else currentUrl.searchParams.delete("lang");
    window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}`);
    setLanguage(nextLanguage);
  };

  const changeMode = (nextMode: SearchMode) => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    const nextUrl = nextMode === "browse"
      ? appUrl("/catalogs", language)
      : nextMode === "photos"
        ? appUrl("/photos", language)
        : appUrl("/", language);
    const nextState: CatalogHistoryState | null = nextMode === "photos" ? { ztCatalogView: "photos" } : null;
    window.history.pushState(nextState, "", nextUrl);
    setMode(nextMode);
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSearchLoading(false);
    setSearchError("");
    setSelected(null);
    setModel("all");
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(null);
    setBrowseCategoryIntent(null);
    setPhotosReturn(false);
  };

  const openPart = (partNumber: string, vinState: VinBrowseState) => {
    window.history.replaceState(
      { ztCatalogView: "vin", vinState } satisfies CatalogHistoryState,
      "",
      appUrl(`/vin/${encodeURIComponent(vinState.vin)}`, language),
    );
    window.history.pushState(
      { ztCatalogView: "part", partNumber, vinState } satisfies CatalogHistoryState,
      "",
      appUrl(`/part/${encodeURIComponent(partNumber)}`, language),
    );
    setVinReturnState(vinState);
    setVinRestoreState(null);
    setPhotosReturn(false);
    setMode("part");
    setQuery(partNumber);
    setSubmitted(partNumber);
    setHasSearched(true);
    setSearchError("");
    setModel("all");
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const openPartFromCatalog = (partNumber: string, browseState: CatalogBrowseState) => {
    window.history.replaceState(
      { ztCatalogView: "browse", browseState } satisfies CatalogHistoryState,
      "",
      appUrl("/catalogs", language, {
        catalog: browseState.catalog,
        category: browseState.category,
        group: browseState.groupId,
        q: browseState.partSearch,
      }),
    );
    window.history.pushState(
      { ztCatalogView: "catalog-part", partNumber, browseState } satisfies CatalogHistoryState,
      "",
      appUrl(`/part/${encodeURIComponent(partNumber)}`, language),
    );
    setCatalogReturnState(browseState);
    setCatalogRestoreState(null);
    setVinReturnState(null);
    setVinRestoreState(null);
    setPhotosReturn(false);
    setMode("part");
    setQuery(partNumber);
    setSubmitted(partNumber);
    setHasSearched(true);
    setSearchError("");
    setModel("all");
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const openPartFromPhotos = (partNumber: string) => {
    window.history.replaceState({ ztCatalogView: "photos" } satisfies CatalogHistoryState, "", appUrl("/photos", language));
    window.history.pushState(
      { ztCatalogView: "part", partNumber, fromPhotos: true } satisfies CatalogHistoryState,
      "",
      appUrl(`/part/${encodeURIComponent(partNumber)}`, language),
    );
    setPhotosReturn(true);
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(null);
    setMode("part");
    setQuery(partNumber);
    setSubmitted(partNumber);
    setHasSearched(true);
    setSearchError("");
    setSelected(null);
    setModel("all");
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const openPartWithinContext = (partNumber: string) => {
    if (vinReturnState) {
      openPart(partNumber, vinReturnState);
      return;
    }
    if (catalogReturnState) {
      openPartFromCatalog(partNumber, catalogReturnState);
      return;
    }
    if (!vinReturnState && !catalogReturnState) {
      search(partNumber);
      return;
    }
  };

  const openSearchResult = (part: Part) => {
    const searchMode = mode === "description" ? "description" : "part";
    window.history.replaceState(
      { ztCatalogView: "search", searchMode, searchQuery: submitted } satisfies CatalogHistoryState,
      "",
      appUrl(`/search/${searchMode}`, language, { q: submitted }),
    );
    window.history.pushState(
      { ztCatalogView: "part", partNumber: part.partNumber, searchMode, searchQuery: submitted } satisfies CatalogHistoryState,
      "",
      appUrl(`/part/${encodeURIComponent(part.partNumber)}`, language),
    );
    setMode("part");
    setQuery(part.partNumber);
    setSubmitted(part.partNumber);
    setHasSearched(true);
    setSelected(part);
    setModel("all");
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const openCatalogFromHome = (catalog: string) => {
    const browseState: CatalogBrowseState = { catalog, category: "all", groupId: "", partSearch: "", scrollY: 0 };
    window.history.pushState(
      { ztCatalogView: "browse", browseState } satisfies CatalogHistoryState,
      "",
      appUrl("/catalogs", language, { catalog }),
    );
    setMode("browse");
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSelected(null);
    setModel("all");
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(browseState);
    setBrowseCategoryIntent(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openBrowseFromHome = (category: CategoryId | null = null) => {
    window.history.pushState(null, "", appUrl("/catalogs", language, { category: category ?? undefined }));
    setMode("browse");
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSelected(null);
    setModel("all");
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(null);
    setBrowseCategoryIntent(category);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const returnToPhotoParts = () => {
    const historyState = window.history.state as CatalogHistoryState | null;
    if (historyState?.ztCatalogView === "part" && historyState.fromPhotos) {
      window.history.back();
      return;
    }
    window.history.pushState({ ztCatalogView: "photos" } satisfies CatalogHistoryState, "", appUrl("/photos", language));
    setMode("photos");
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSelected(null);
    setModel("all");
    setPhotosReturn(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const returnToVinResults = () => {
    const historyState = window.history.state as CatalogHistoryState | null;
    if (historyState?.ztCatalogView === "part") {
      window.history.back();
      return;
    }
    if (!vinReturnState) return;
    pendingScrollY.current = vinReturnState.scrollY;
    setMode("vin");
    setQuery(vinReturnState.vin);
    setSubmitted(vinReturnState.vin);
    setHasSearched(true);
    setSelected(null);
    setModel("all");
    setVinRestoreState(vinReturnState);
    setVinReturnState(null);
  };

  const returnToCatalogBrowse = () => {
    const historyState = window.history.state as CatalogHistoryState | null;
    if (historyState?.ztCatalogView === "catalog-part") {
      window.history.back();
      return;
    }
    if (!catalogReturnState) return;
    const savedState = catalogReturnState;
    setMode("browse");
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSelected(null);
    setModel("all");
    setCatalogRestoreState(savedState);
    setCatalogReturnState(null);
    window.setTimeout(() => window.scrollTo({ top: savedState.scrollY, behavior: "auto" }), 50);
  };

  const openCatalogLocation = (part: Part, occurrence: Occurrence, level: "catalogs" | "catalog" | "assembly") => {
    const fallbackCategory = categoryFor(part, occurrence);
    const groupCode = data?.groups[occurrence.groupId]?.code || occurrence.assemblyCode;
    const category = groupCode ? categoryForGroup(groupCode, fallbackCategory) : fallbackCategory;
    const browseState = level === "catalogs" ? null : {
      catalog: occurrence.catalog,
      category: level === "assembly" ? category : "all" as const,
      groupId: level === "assembly" ? occurrence.groupId : "",
      partSearch: "",
      scrollY: 0,
    };
    window.history.pushState(
      browseState ? { ztCatalogView: "browse", browseState } satisfies CatalogHistoryState : null,
      "",
      appUrl("/catalogs", language, browseState ? {
        catalog: browseState.catalog,
        category: browseState.category,
        group: browseState.groupId,
      } : {}),
    );
    setMode("browse");
    setQuery("");
    setSubmitted("");
    setHasSearched(false);
    setSelected(null);
    setModel("all");
    setVinReturnState(null);
    setVinRestoreState(null);
    setCatalogReturnState(null);
    setCatalogRestoreState(browseState);
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const updateCatalogUrl = (browseState: CatalogBrowseState | null) => {
    window.history.replaceState(
      browseState ? { ztCatalogView: "browse", browseState } satisfies CatalogHistoryState : null,
      "",
      appUrl("/catalogs", language, browseState ? {
        catalog: browseState.catalog,
        category: browseState.category,
        group: browseState.groupId,
        q: browseState.partSearch,
      } : { category: browseCategoryIntent ?? undefined }),
    );
  };

  const showResultsPanel = results.length > 1 || (
    results.length === 1 && normalize(results[0].partNumber) !== normalize(submitted)
  );
  const searchHint = mode === "vin"
    ? (he ? "דוגמה: LDYGCS2C2H0001712 · בדיוק 17 תווים" : "Example: LDYGCS2C2H0001712 · exactly 17 characters")
    : mode === "description"
      ? (he ? "אפשר לחפש בעברית או באנגלית, למשל: מנוע מגב" : "Search in Hebrew or English, for example: wiper motor")
      : (he ? "אפשר להזין מק״ט מלא או חלק ממנו, למשל: 3747-86" : "Enter a full or partial part number, for example: 3747-86");
  const resultsAnnouncement = searchLoading || (dataLoading && hasSearched)
    ? (he ? "החיפוש מתבצע" : "Search in progress")
    : submitted && (mode === "part" || mode === "description")
      ? (he ? `נמצאו ${results.length} תוצאות` : `${results.length} results found`)
      : mode === "vin" && submitted && !dataLoading
        ? (vinCatalog ? (he ? "נמצא קטלוג מתאים לשלדה" : "A matching VIN catalog was found") : (he ? "לא נמצא קטלוג מתאים לשלדה" : "No matching VIN catalog was found"))
        : "";

  return (
    <main dir={he ? "rtl" : "ltr"} lang={language}>
      <a className="skipLink" href="#main-content">{he ? "דלג לתוכן הראשי" : "Skip to main content"}</a>
      <header className="topbar">
        <div className="productIdentity">
          <div className="zhongtongLogoCrop">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="zhongtongLogo" src="/brand/zhongtong-official.png" alt="Zhongtong" />
          </div>
          <div className="productName">
            <strong>{he ? "קטלוג חלפים" : "Parts Catalog"}</strong>
            <span>{he ? "מאיר — יבואנית אוטובוסי Zhongtong בישראל" : "Mayer — Zhongtong bus importer in Israel"}</span>
          </div>
        </div>
        <h1 className="srOnly">{he ? "מנוע חיפוש וזיהוי חלפים" : "Parts Search and Identification"}</h1>
        <div className="topActions">
          <button className="languageToggle" onClick={changeLanguage} aria-label={he ? "Switch to English" : "החלפה לעברית"}>
            <span className={he ? "active" : ""}>עברית</span><span className={!he ? "active" : ""}>English</span>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="meirLogo" src="/brand/meir-official.svg" alt={he ? "מאיר" : "Mayer"} />
        </div>
      </header>

      <nav className="appNav" aria-label={he ? "ניווט ראשי" : "Primary navigation"}>
        <button className={mode === "part" || mode === "description" ? "active" : ""} onClick={() => changeMode("part")}>{he ? "חיפוש חלפים" : "Parts search"}</button>
        <button className={mode === "vin" ? "active" : ""} onClick={() => changeMode("vin")}>{he ? "קטלוג לפי שלדה" : "VIN catalog"}</button>
        <button className={mode === "browse" ? "active" : ""} onClick={() => changeMode("browse")}>{he ? "שיטוט בקטלוגים" : "Browse catalogs"}</button>
        <button className={mode === "photos" ? "active" : ""} onClick={() => changeMode("photos")}>{he ? "מק״טים עם תמונה" : "Parts with photos"}</button>
      </nav>

      <div className={mode === "photos" ? "applicationShell photosMode" : "applicationShell"}>
        {mode !== "photos" && <section className={isHome ? "searchBand homeSearchBand" : submitted || mode === "browse" ? "searchBand compact" : "searchBand"}>
          <div className="railTitle">
            <strong>{he ? "חיפוש" : "Search"}</strong>
            <span aria-hidden="true">‹</span>
          </div>
          <div className="searchInner">
            {!submitted && <div className="intro">
              <span>{isHome ? (he ? "קטלוג חלפים מקצועי" : "Professional parts catalog") : "Zhongtong Parts"}</span>
              <h2>{isHome
                ? (he ? "כל חלפי Zhongtong — בחיפוש אחד" : "All Zhongtong parts. One search.")
                : mode === "browse" ? (he ? "שיטוט בקטלוגים" : "Browse catalogs") : (he ? "איתור חלפים" : "Find parts")}</h2>
              <p>{mode === "browse"
                ? (he ? "בחר קטלוג, מערכת ומכלול כדי להגיע לשרטוט ולרשימת החלקים." : "Choose a catalog, system and assembly to reach its diagram and parts list.")
                : isHome
                  ? (he ? "מצא את החלק הנכון לפי מק״ט, תיאור או מספר שלדה — עם שרטוט היצרן והמיקום המדויק במכלול." : "Find the right part by part number, description or VIN, with the manufacturer diagram and exact assembly position.")
                  : (he ? "חיפוש לפי מק״ט, תיאור מילולי או מספר שלדה." : "Search by part number, description or VIN.")}</p>
            </div>}
            <div className="searchModeTabs" role="tablist" aria-label={he ? "סוג חיפוש" : "Search type"}>
              <button type="button" role="tab" aria-selected={mode === "part"} className={mode === "part" ? "active" : ""} onClick={() => changeMode("part")}>
                <span aria-hidden="true">#</span>{he ? "לפי מק״ט" : "Part number"}
              </button>
              <button type="button" role="tab" aria-selected={mode === "description"} className={mode === "description" ? "active" : ""} onClick={() => changeMode("description")}>
                <span aria-hidden="true">Aa</span>{he ? "לפי תיאור" : "Description"}
              </button>
              <button type="button" role="tab" aria-selected={mode === "vin"} className={mode === "vin" ? "active" : ""} onClick={() => changeMode("vin")}>
                <span aria-hidden="true">▣</span>{he ? "לפי שלדה" : "VIN"}
              </button>
              <button type="button" role="tab" aria-selected={mode === "browse"} className={mode === "browse" ? "active" : ""} onClick={() => changeMode("browse")}>
                <span aria-hidden="true">☷</span>{he ? "שיטוט" : "Browse"}
              </button>
            </div>
            {mode !== "browse" && <form className="searchBox" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <label htmlFor="catalog-search">{mode === "vin"
                ? (he ? "מספר שלדה (VIN)" : "VIN")
                : mode === "description"
                  ? (he ? "שם החלק או תיאור" : "Part name or description")
                  : (he ? "מק״ט" : "Part no.")}</label>
              <input
                id="catalog-search"
                value={query}
                onChange={(e) => setQuery(mode === "vin" ? normalizeVin(e.target.value) : e.target.value)}
                placeholder={mode === "vin"
                  ? (he ? "17 תווים ללא רווחים" : "17 characters, no spaces")
                  : mode === "description"
                    ? (he ? "לדוגמה: מנוע מגב, רפידות בלם או door handle" : "For example: wiper motor, brake pads or door handle")
                    : (he ? "לדוגמה: 3747-86-00012" : "For example: 3747-86-00012")}
                aria-label={mode === "vin"
                  ? (he ? "מספר שלדה" : "VIN")
                  : mode === "description"
                    ? (he ? "תיאור החלק" : "Part description")
                    : (he ? "מק״ט" : "Part number")}
                aria-describedby="catalog-search-hint"
                aria-invalid={Boolean(searchError)}
                maxLength={mode === "vin" ? 17 : undefined}
                dir={mode === "description" && he ? "rtl" : "ltr"}
                autoFocus
              />
              <div className="searchButtons">
                <button
                  type="button"
                  className="clearSearch"
                  onClick={clearSearch}
                >
                  {he ? "נקה" : "Clear"}
                </button>
                <button type="submit" className="submitSearch"><span aria-hidden="true">⌕</span>{he ? "חיפוש" : "Search"}</button>
              </div>
            </form>}
            {mode !== "browse" && <div className={searchError ? "searchFieldFeedback error" : "searchFieldFeedback"}>
              <span id="catalog-search-hint">{searchHint}</span>
              {searchError && <strong role="alert"><AlertCircle size={14} aria-hidden="true" />{searchError}</strong>}
            </div>}
            {!submitted && mode !== "browse" && <div className="quickRow">
              <span>{he ? "חיפוש מהיר" : "Quick search"}</span>
              {(mode === "vin"
                ? data?.catalogs.flatMap((catalog) => catalog.vinNumbers ?? []).slice(0, 3) ?? []
                : mode === "description"
                  ? (he ? ["מנוע מגב", "רפידות בלם", "ידית דלת"] : ["Wiper motor", "Brake pads", "Door handle"])
                  : ["3747-86-00012", "5301-00-02259", "3400-10-01184"]
              ).map((value) => (
                <button key={value} onClick={() => search(value)}>{value}</button>
              ))}
            </div>}
          </div>
        </section>}

        <section id="main-content" tabIndex={-1} className={isHome ? "workspace homeWorkspace" : "workspace"}>
          <div className="srOnly" role="status" aria-live="polite" aria-atomic="true">{resultsAnnouncement}</div>
          {!isHome && <div className="workspaceHeading">
            <strong>{mode === "photos" ? (he ? "גלריית חלקים" : "Parts gallery") : (he ? "ניווט" : "Navigate")}</strong>
            {submitted && <span dir="ltr">{submitted}</span>}
          </div>}
          {isHome && data && <div className="homeDiscovery">
            <section className="homeCollections" aria-labelledby="home-collections-title">
              <div className="homeSectionHeading">
                <div><span>{he ? "חיפוש לפי מערכת" : "Browse by system"}</span><h2 id="home-collections-title">{he ? "מערכות מרכזיות" : "Main systems"}</h2></div>
                <button type="button" onClick={() => openBrowseFromHome()}>{he ? "לכל המערכות" : "All systems"}<span aria-hidden="true">{he ? "←" : "→"}</span></button>
              </div>
              <div className="homeCategoryGrid">
                {CATEGORIES.filter((category) => ["powertrain", "brakes", "electrical", "body", "hvac", "drive"].includes(category.id)).map((category) => (
                  <button type="button" key={category.id} onClick={() => openBrowseFromHome(category.id)}>
                    <span className="homeCategoryIcon"><SystemIcon category={category.id} /></span>
                    <strong>{he ? category.he : category.en}</strong>
                    <small>{(homeCategoryCounts.get(category.id) ?? 0).toLocaleString(he ? "he-IL" : "en-US")} {he ? "מק״טים" : "parts"}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="homeCatalogs" aria-labelledby="home-catalogs-title">
              <div className="homeSectionHeading">
                <div><span>{he ? "גישה מהירה" : "Quick access"}</span><h2 id="home-catalogs-title">{he ? "קטלוגים מרכזיים" : "Featured catalogs"}</h2></div>
                <button type="button" onClick={() => changeMode("browse")}>{he ? "כל הקטלוגים" : "All catalogs"}<span aria-hidden="true">{he ? "←" : "→"}</span></button>
              </div>
              <div className="homeCatalogGrid">
                {featuredCatalogs.map((catalog) => (
                  <button type="button" key={catalog.catalog} onClick={() => openCatalogFromHome(catalog.catalog)}>
                    <span className="homeCatalogVehicle"><BusFront size={28} /></span>
                    <span className="homeCatalogCopy">
                      <small>{he ? "קטלוג Zhongtong" : "Zhongtong catalog"}</small>
                      <strong>{catalog.model || catalog.catalog.match(/LCK[A-Z0-9]+/)?.[0] || catalog.catalog}</strong>
                      <em>{[catalog.year, catalog.vehicleType, catalog.engine].filter(Boolean).join(" · ") || catalog.catalog}</em>
                    </span>
                    <span className="homeCatalogMeta"><b>{(catalog.parts ?? 0).toLocaleString(he ? "he-IL" : "en-US")}</b>{he ? "חלקים" : "parts"}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="homeTrustStrip">
              <div><ShieldCheck size={22} /><span><strong>{he ? "מקור אמת" : "Source of truth"}</strong><small>{he ? "מידע ישירות מקטלוגי היצרן" : "Data from manufacturer catalogs"}</small></span></div>
              <div><ScanSearch size={22} /><span><strong>{he ? "איתור מדויק" : "Precise identification"}</strong><small>{he ? "מק״ט, תיאור, שלדה ומיקום בשרטוט" : "Part, description, VIN and diagram position"}</small></span></div>
              <div><Layers3 size={22} /><span><strong>{he ? "הקשר נשמר" : "Context stays put"}</strong><small>{he ? "החיפוש נשאר בתוך השלדה או הקטלוג שנבחרו" : "Search stays inside the selected VIN or catalog"}</small></span></div>
            </section>
          </div>}
          {(searchLoading || (dataLoading && hasSearched) || !routeReady) && <div className="catalogLoadingState" role="status">
            <LoaderCircle className="loadingSpinner" size={25} aria-hidden="true" />
            <div><strong>{he ? "מחפש בקטלוגים..." : "Searching the catalogs..."}</strong><span>{he ? "טוען את המידע ומאתר התאמות." : "Loading data and finding matches."}</span></div>
            <span className="loadingSkeleton" aria-hidden="true" />
          </div>}
          {dataLoadError && <div className="catalogErrorState" role="alert">
            <AlertCircle size={24} aria-hidden="true" />
            <div><strong>{he ? "לא הצלחנו לטעון את הקטלוג" : "The catalog could not be loaded"}</strong><span>{he ? "בדוק את החיבור ונסה לרענן את העמוד." : "Check the connection and refresh the page."}</span></div>
            <button type="button" onClick={() => window.location.reload()}>{he ? "רענון" : "Refresh"}</button>
          </div>}
          {!isHome && !submitted && !hasSearched && !searchLoading && !dataLoading && mode !== "browse" && mode !== "photos" && <div className="infoBanner" role="status">
            <b aria-hidden="true">i</b>
            <div>
              <strong>{he ? "לא הוזן חיפוש" : "No search provided"}</strong>
              <span>{he ? "כדי לקבל תוצאה, הזן מק״ט, תיאור חלק או מספר שלדה בחלונית החיפוש." : "Enter a part number, description or VIN in the search panel to get a result."}</span>
            </div>
          </div>}

          {!isHome && !submitted && !hasSearched && !searchLoading && !dataLoading && mode !== "browse" && mode !== "photos" && <div className="stats">
            <div><b>{data ? data.uniqueParts.toLocaleString(he ? "he-IL" : "en-US") : "..."}</b><span>{he ? "מק״טים ייחודיים" : "Unique parts"}</span></div>
            <div><b>{data ? data.occurrenceCount.toLocaleString(he ? "he-IL" : "en-US") : "..."}</b><span>{he ? "הופעות בקטלוגים" : "Catalog matches"}</span></div>
            <div><b>{data ? data.catalogCount : "..."}</b><span>{he ? "קטלוגים מאוחדים" : "Unified catalogs"}</span></div>
            <div><b>{data ? vinCount.toLocaleString(he ? "he-IL" : "en-US") : "..."}</b><span>{he ? "שלדות ניתנות לחיפוש" : "Searchable VINs"}</span></div>
          </div>}

          {(mode === "part" || mode === "description") && submitted && !searchLoading && !dataLoading && !dataLoadError && (
            <>
            {mode === "description" && rankedResults.analysis && <section className="smartSearchSummary" aria-live="polite">
              <span className="smartSearchSummaryIcon" aria-hidden="true"><Sparkles size={18} /></span>
              <div>
                <span>{he ? "כך הבנתי את החיפוש" : "How I understood the search"}</span>
                <strong>{he ? rankedResults.analysis.understoodHe : rankedResults.analysis.understoodEn}</strong>
                <small>{he ? "התוצאות מדורגות לפי תיאור, מונחי מוסך, דגם, שנה, צד והמיקום בשרטוט." : "Results are ranked by description, workshop terminology, model, year, side, and diagram position."}</small>
              </div>
              <b>{he ? "מבוסס על נתוני הקטלוג בלבד" : "Catalog data only"}</b>
            </section>}
            <div className={showResultsPanel ? "resultsLayout" : "resultsLayout singleResult"} aria-live="polite" aria-busy={searchLoading}>
              {showResultsPanel && <aside className="resultsPanel">
                <div className="panelHead">
                  <div><span>{he ? "תוצאות עבור" : "Results for"}</span><strong>{submitted}</strong></div>
                  <select value={model} onChange={(e) => setModel(e.target.value)} aria-label={he ? "סינון לפי דגם" : "Filter by model"}>
                    <option value="all">{he ? "הכול" : "All"}</option>
                    {models.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div className="resultCount" role="status">{he ? `נמצאו ${results.length} תוצאות${results.length === 50 ? " ראשונות" : ""}` : `${results.length}${results.length === 50 ? " first" : ""} results found`}</div>
                <div className="resultList">
                  {results.map((part) => {
                    const match = resultMatchByPart.get(part.partNumber);
                    return <div className="resultRowWithCopy" key={part.partNumber}>
                      <button className={selected?.partNumber === part.partNumber ? "result active" : "result"} onClick={() => openSearchResult(part)}>
                        <strong dir="ltr">{part.partNumber}</strong>
                        <span>{displayPartDescription(part, he, he ? "ללא תיאור" : "No description")}</span>
                        {mode === "description" && match && <span className="smartMatchLine">
                          <em className={`smartConfidence ${match.confidence}`}>{smartConfidenceLabel(match.confidence, he)}</em>
                          <small>{he ? match.reasonHe : match.reasonEn}</small>
                        </span>}
                        <small>{part.models.join(" · ")} <em>{part.occurrences.length} {he ? "הופעות" : "matches"}</em></small>
                      </button>
                      <CopyPartNumberButton partNumber={part.partNumber} he={he} compact />
                    </div>;
                  })}
                  {!results.length && <div className="noResults"><b>{he ? "לא נמצא חלק מתאים" : "No matching part found"}</b><span>{mode === "description"
                    ? (he ? "נסה שם קצר יותר, מילה אחרת או תיאור באנגלית." : "Try a shorter name, another term or a different description.")
                    : (he ? "נסה מק״ט חלקי או בדוק את הספרות." : "Try a partial part number or check the digits.")}</span></div>}
                </div>
              </aside>}

              <section className="detailPanel">
                {mode === "description" && selected && resultMatchByPart.get(selected.partNumber) && <div className="smartSelectedEvidence">
                  <Sparkles size={17} aria-hidden="true" />
                  <div>
                    <strong>{smartConfidenceLabel(resultMatchByPart.get(selected.partNumber)!.confidence, he)}</strong>
                    <span>{(he ? resultMatchByPart.get(selected.partNumber)!.detailsHe : resultMatchByPart.get(selected.partNumber)!.detailsEn).join(" · ")}</span>
                  </div>
                </div>}
                {photosReturn && <nav className="returnNav" aria-label={he ? "חזרה למק״טים עם תמונה" : "Back to parts with photos"}>
                  <button className="returnButton" type="button" onClick={returnToPhotoParts}>
                    <span className="returnArrow" aria-hidden="true">{he ? "→" : "←"}</span>
                    <span className="returnText">
                      <strong>{he ? "חזרה למק״טים עם תמונה" : "Back to parts with photos"}</strong>
                      <small>{he ? "גלריית החלקים" : "Parts gallery"}</small>
                    </span>
                  </button>
                </nav>}
                {vinReturnState && <nav className="returnNav" aria-label={he ? "חזרה לתוצאות השלדה" : "Back to VIN results"}>
                  <button className="returnButton" type="button" onClick={returnToVinResults}>
                    <span className="returnArrow" aria-hidden="true">{he ? "→" : "←"}</span>
                    <span className="returnText">
                      <strong>{he ? "חזרה לתוצאות השלדה" : "Back to VIN results"}</strong>
                      <small dir="ltr">{vinReturnState.vin}</small>
                    </span>
                  </button>
                </nav>}
                {catalogReturnState && <nav className="returnNav" aria-label={he ? "חזרה לשיטוט בקטלוג" : "Back to catalog browsing"}>
                  <button className="returnButton" type="button" onClick={returnToCatalogBrowse}>
                    <span className="returnArrow" aria-hidden="true">{he ? "→" : "←"}</span>
                    <span className="returnText">
                      <strong>{he ? "חזרה למכלול בקטלוג" : "Back to catalog assembly"}</strong>
                      <small>{catalogReturnState.catalog}</small>
                    </span>
                  </button>
                </nav>}
                {selected && data && <PartDetail
                  key={selected.partNumber}
                  part={selected}
                  groups={data.groups}
                  partIndex={partIndex}
                  catalogVins={catalogVins}
                  preferredCatalog={contextualCatalog}
                  preferredGroupId={catalogReturnState?.groupId}
                  onSearch={openPartWithinContext}
                  onBrowseLocation={openCatalogLocation}
                  he={he}
                />}
                {!selected && <div className="noResults large" role="status">
                  <AlertCircle size={28} aria-hidden="true" />
                  <b>{he ? "לא מצאנו חלק מתאים" : "No matching part was found"}</b>
                  <span>{mode === "description"
                    ? (he ? "נסה שם קצר יותר, מילה אחרת או חיפוש לפי מק״ט." : "Try a shorter name, another term, or search by part number.")
                    : (he ? "בדוק את הספרות, נסה מק״ט חלקי או חיפוש לפי תיאור." : "Check the digits, try a partial number, or search by description.")}</span>
                  <div className="noResultsActions">
                    <button type="button" onClick={() => changeMode(mode === "description" ? "part" : "description")}>{mode === "description" ? (he ? "חיפוש לפי מק״ט" : "Search by part number") : (he ? "חיפוש לפי תיאור" : "Search by description")}</button>
                    <button type="button" onClick={() => changeMode("vin")}>{he ? "חיפוש לפי שלדה" : "Search by VIN"}</button>
                  </div>
                </div>}
              </section>
            </div>
            </>
          )}

          {mode === "vin" && submitted && data && (
            <VinSearchResult
              key={submitted}
              vin={submitted}
              catalog={vinCatalog}
              data={data}
              he={he}
              onOpenPart={openPart}
              onTryMode={changeMode}
              initialState={vinRestoreState}
            />
          )}

          {mode === "browse" && data && (
            <CatalogBrowser
              data={data}
              he={he}
              initialState={catalogRestoreState}
              landingCategory={browseCategoryIntent}
              onOpenPart={openPartFromCatalog}
              onStateChange={updateCatalogUrl}
            />
          )}

          {mode === "photos" && data && (
            <PhotoPartsPage data={data} he={he} onOpenPart={openPartFromPhotos} />
          )}
        </section>
      </div>
      <footer>{he ? "מאיר — יבואנית אוטובוסי Zhongtong בישראל · המידע מוצג כפי שמופיע בקטלוגי היצרן · התאמת VIN היא ברמת הקטלוג · עדכון קטלוגים: 20.8.2026" : "Mayer — Zhongtong bus importer in Israel · Information is displayed as published in the manufacturer catalogs · VIN matching is catalog-level · Catalogs updated August 20, 2026"}</footer>
    </main>
  );
}

function PhotoPartsPage({ data, he, onOpenPart }: {
  data: Data;
  he: boolean;
  onOpenPart: (partNumber: string) => void;
}) {
  const [parts, setParts] = useState<PhotoPartSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const partIndex = useMemo(() => new Map(data.parts.map((part) => [part.partNumber, part])), [data.parts]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/photos?scope=parts", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { parts?: PhotoPartSummary[]; error?: string };
        if (!response.ok || !result.parts) throw new Error(result.error || `photos-${response.status}`);
        return result.parts;
      })
      .then(setParts)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLoadFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const filteredParts = useMemo(() => {
    const query = filter.trim();
    if (!query) return parts;
    return parts.filter((item) => {
      const part = partIndex.get(item.partNumber);
      return matchesSearch([
        item.partNumber,
        part?.descriptionHebrew ?? "",
        part?.description ?? "",
        part?.descriptionChinese ?? "",
        ...(part?.models ?? []),
        ...(part?.assemblies ?? []),
      ].join(" "), query);
    });
  }, [filter, partIndex, parts]);

  return <section className="photoPartsPage">
    <div className="photoPartsHero">
      <div>
        <span>{he ? "תמונות אמיתיות מהשטח" : "Real-world part photos"}</span>
        <h2>{he ? "מק״טים עם תמונה" : "Parts with photos"}</h2>
        <p>{he
          ? "כאן מופיעים רק מק״טים שנשמרה עבורם לפחות תמונה אחת."
          : "Only part numbers with at least one saved photo are shown here."}</p>
      </div>
      <div className="photoPartsCount">
        <b>{loading ? "…" : parts.length.toLocaleString(he ? "he-IL" : "en-US")}</b>
        <span>{he ? "מק״טים עם תמונה" : "parts with photos"}</span>
      </div>
    </div>

    <div className="photoPartsToolbar">
      <label>
        <span>{he ? "חיפוש בגלריה" : "Search gallery"}</span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={he ? "חיפוש לפי מק״ט, תיאור או דגם..." : "Search by part number, description or model..."}
          aria-label={he ? "חיפוש במק״טים עם תמונה" : "Search parts with photos"}
        />
      </label>
      {!loading && !loadFailed && <span>{he
        ? `מוצגים ${filteredParts.length.toLocaleString("he-IL")} מתוך ${parts.length.toLocaleString("he-IL")}`
        : `Showing ${filteredParts.length.toLocaleString("en-US")} of ${parts.length.toLocaleString("en-US")}`}</span>}
    </div>

    {loading && <div className="photoPartsState"><Camera size={28} aria-hidden="true" /><strong>{he ? "טוען תמונות..." : "Loading photos..."}</strong></div>}
    {!loading && loadFailed && <div className="photoPartsState error" role="alert">
      <Camera size={28} aria-hidden="true" />
      <strong>{he ? "לא ניתן לטעון כרגע את רשימת התמונות." : "The photo list could not be loaded."}</strong>
      <button type="button" onClick={() => {
        setLoading(true);
        setLoadFailed(false);
        setReloadToken((value) => value + 1);
      }}>{he ? "נסה שוב" : "Try again"}</button>
    </div>}
    {!loading && !loadFailed && !parts.length && <div className="photoPartsState">
      <Camera size={30} aria-hidden="true" />
      <strong>{he ? "עדיין לא נשמרו תמונות למק״טים" : "No part photos have been saved yet"}</strong>
      <span>{he ? "ברגע שתישמר תמונה בכרטיס חלק, המק״ט יופיע כאן אוטומטית." : "A part will appear here automatically after its first photo is saved."}</span>
    </div>}
    {!loading && !loadFailed && parts.length > 0 && !filteredParts.length && <div className="photoPartsState">
      <strong>{he ? "לא נמצאה התאמה בחיפוש" : "No matching part found"}</strong>
      <span>{he ? "נסה מק״ט חלקי או מילה אחרת מהתיאור." : "Try a partial part number or another description term."}</span>
    </div>}

    {!loading && !loadFailed && filteredParts.length > 0 && <div className="photoPartsGrid">
      {filteredParts.map((item) => {
        const part = partIndex.get(item.partNumber);
        const description = displayPartDescription(part, he, he ? "ללא תיאור בקטלוג" : "No catalog description");
        return <article className="photoPartTile" key={item.partNumber}>
          <button
            type="button"
            className="photoPartOpenOverlay"
            onClick={() => onOpenPart(item.partNumber)}
            aria-label={he ? `פתיחת כרטיס מק״ט ${item.partNumber}` : `Open part ${item.partNumber}`}
          />
          <span className="photoPartImage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.latestPhoto.url} alt={`${he ? "תמונה של מק״ט" : "Photo of part"} ${item.partNumber}`} loading="lazy" decoding="async" />
            <span>{item.photoCount > 1 ? `+${item.photoCount - 1}` : "1"}</span>
          </span>
          <span className="photoPartContent">
            <span className="photoPartNumberLine"><b dir="ltr">{item.partNumber}</b><CopyPartNumberButton partNumber={item.partNumber} he={he} compact /></span>
            <strong>{description}</strong>
            <small>{part?.models.slice(0, 3).join(" · ") || (he ? "דגם לא צוין" : "Model not specified")}</small>
            <span className="photoPartStatusLine">
              {item.verifiedCount > 0
                ? <em className="verified"><CheckCircle2 size={13} />{he ? `${item.verifiedCount} מאומתות` : `${item.verifiedCount} verified`}</em>
                : null}
              {item.pendingCount > 0
                ? <em className="pending"><Clock3 size={13} />{he ? `${item.pendingCount} ממתינות` : `${item.pendingCount} pending`}</em>
                : null}
            </span>
          </span>
          <span className="photoPartOpen">{he ? "פתיחת כרטיס חלק" : "Open part card"} <span aria-hidden="true">{he ? "←" : "→"}</span></span>
        </article>;
      })}
    </div>}
  </section>;
}

function CatalogBrowser({ data, he, initialState, landingCategory, onOpenPart, onStateChange }: {
  data: Data;
  he: boolean;
  initialState: CatalogBrowseState | null;
  landingCategory: CategoryId | null;
  onOpenPart: (partNumber: string, browseState: CatalogBrowseState) => void;
  onStateChange: (browseState: CatalogBrowseState | null) => void;
}) {
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogName, setCatalogName] = useState(initialState?.catalog ?? "");
  const [category, setCategory] = useState<"all" | CategoryId>(initialState?.category ?? landingCategory ?? "all");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupId, setGroupId] = useState(initialState?.groupId ?? "");
  const [partSearch, setPartSearch] = useState(initialState?.partSearch ?? "");
  const [assemblyPartSearch, setAssemblyPartSearch] = useState("");
  const [focusedPartNumber, setFocusedPartNumber] = useState("");
  const [browseWorkbenchView, setBrowseWorkbenchView] = useState<WorkbenchView>("split");
  const [browseDiagramZoom, setBrowseDiagramZoom] = useState(100);
  const [recentBrowse, setRecentBrowse] = useState<CatalogBrowseState | null>(null);
  const categorySectionRef = useRef<HTMLElement | null>(null);
  const assemblyListRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const partIndex = useMemo(() => new Map(data.parts.map((part) => [part.partNumber, part])), [data.parts]);
  const occurrenceByGroup = useMemo(() => {
    const index = new Map<string, { part: Part; occurrence: Occurrence }>();
    data.parts.forEach((part) => part.occurrences.forEach((occurrence) => {
      if (occurrence.groupId && !index.has(occurrence.groupId)) index.set(occurrence.groupId, { part, occurrence });
    }));
    return index;
  }, [data.parts]);

  const catalogs = useMemo(() => data.catalogs
    .filter((catalog) => {
      if (!catalogSearch.trim()) return true;
      return matchesSearch([
        catalog.catalog,
        catalog.model ?? "",
        catalog.year ?? "",
        catalog.engine ?? "",
        catalog.vehicleType ?? "",
      ].join(" "), catalogSearch);
    })
    .sort((a, b) => `${a.model ?? ""}-${a.year ?? ""}`.localeCompare(`${b.model ?? ""}-${b.year ?? ""}`)), [catalogSearch, data.catalogs]);

  const selectedCatalog = data.catalogs.find((catalog) => catalog.catalog === catalogName) ?? null;
  const selectedCategory = category === "all" ? null : CATEGORIES.find((item) => item.id === category) ?? null;
  const recentCatalog = recentBrowse ? data.catalogs.find((catalog) => catalog.catalog === recentBrowse.catalog) ?? null : null;
  const recentGroup = recentBrowse?.groupId ? data.groups[recentBrowse.groupId] : null;
  const groups = useMemo(() => Object.entries(data.groups)
    .filter(([, group]) => group.catalog === catalogName)
    .map(([id, group]) => {
      const match = occurrenceByGroup.get(id);
      return {
        id,
        group,
        category: categoryForGroup(group.code, match ? categoryFor(match.part, match.occurrence) : "other"),
      };
    })
    .filter((row) => row.group.title || row.group.code || row.group.figure)
    .sort((a, b) => `${a.group.code} ${a.group.title}`.localeCompare(`${b.group.code} ${b.group.title}`)), [catalogName, data.groups, occurrenceByGroup]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    groups.forEach((row) => counts.set(row.category, (counts.get(row.category) ?? 0) + 1));
    return counts;
  }, [groups]);

  const visibleGroups = useMemo(() => groups
    .filter((row) => category === "all" || row.category === category)
    .filter((row) => !groupSearch.trim() || matchesSearch(`${row.group.code} ${row.group.title}`, groupSearch)), [category, groupSearch, groups]);

  const selectedGroup = groupId ? data.groups[groupId] : null;
  const selectedGroupParts = useMemo(() => {
    if (!selectedGroup || !groupId) return [];
    return selectedGroup.parts.map((partNumber) => {
      const part = partIndex.get(partNumber);
      const occurrence = part?.occurrences.find((item) => item.groupId === groupId);
      return { partNumber, part, occurrence };
    })
      .filter((row, index, rows) => rows.findIndex((item) => item.partNumber === row.partNumber) === index)
      .sort((a, b) => compareDiagramPositions(a.occurrence?.position, b.occurrence?.position)
        || a.partNumber.localeCompare(b.partNumber));
  }, [groupId, partIndex, selectedGroup]);
  const visibleSelectedGroupParts = useMemo(() => {
    const query = assemblyPartSearch.trim();
    if (!query) return selectedGroupParts;
    return selectedGroupParts.filter((row) => matchesSearch([
      row.partNumber,
      displayPartDescription(row.part, he, row.occurrence?.description || ""),
      row.occurrence?.position || "",
      row.occurrence?.quantity || "",
      row.occurrence?.unit || "",
      row.occurrence?.notes || "",
    ].join(" "), query));
  }, [assemblyPartSearch, he, selectedGroupParts]);
  const focusedGroupPart = selectedGroupParts.find((row) => row.partNumber === focusedPartNumber) ?? selectedGroupParts[0] ?? null;

  const catalogPartResults = useMemo(() => {
    const query = partSearch.trim();
    if (!catalogName || !query) return [];
    return rankSmartParts(data.parts, query, (occurrence) => occurrence.catalog === catalogName).ranked;
  }, [catalogName, data.parts, partSearch]);

  useEffect(() => {
    let timer: number | undefined;
    try {
      const saved = window.localStorage.getItem("ztCatalogLastBrowse");
      if (!saved) return;
      const parsed = JSON.parse(saved) as CatalogBrowseState;
      if (parsed.catalog && data.catalogs.some((catalog) => catalog.catalog === parsed.catalog)) {
        timer = window.setTimeout(() => setRecentBrowse(parsed), 0);
      }
    } catch {
      // A damaged local preference should never block catalog navigation.
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [data.catalogs]);

  useEffect(() => {
    if (!catalogName) return;
    const state: CatalogBrowseState = { catalog: catalogName, category, groupId, partSearch, scrollY: window.scrollY };
    try {
      window.localStorage.setItem("ztCatalogLastBrowse", JSON.stringify(state));
    } catch {
      // Browsing still works when the browser blocks local storage.
    }
  }, [catalogName, category, groupId, partSearch]);

  useEffect(() => {
    if (!catalogName) {
      onStateChange(null);
      return;
    }
    onStateChange({ catalog: catalogName, category, groupId, partSearch, scrollY: window.scrollY });
  }, [catalogName, category, groupId, onStateChange, partSearch]);

  const chooseCatalog = (value: string) => {
    const nextCategory = value ? landingCategory ?? "all" : "all";
    setCatalogName(value);
    setCategory(nextCategory);
    setGroupSearch("");
    setGroupId("");
    setPartSearch("");
    setAssemblyPartSearch("");
    setFocusedPartNumber("");
    setBrowseWorkbenchView("split");
    setBrowseDiagramZoom(100);
    if (value) setRecentBrowse({ catalog: value, category: nextCategory, groupId: "", partSearch: "", scrollY: window.scrollY });
    window.scrollTo({ top: 72, behavior: "smooth" });
  };

  const chooseCategory = (value: "all" | CategoryId) => {
    setCategory(value);
    setGroupSearch("");
    setGroupId("");
    setAssemblyPartSearch("");
    setFocusedPartNumber("");
    setBrowseDiagramZoom(100);
    if (catalogName) setRecentBrowse({ catalog: catalogName, category: value, groupId: "", scrollY: window.scrollY });
    window.setTimeout(() => assemblyListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  };

  const chooseGroup = (value: string) => {
    setGroupId(value);
    setAssemblyPartSearch("");
    setFocusedPartNumber(data.groups[value]?.parts[0] ?? "");
    setBrowseWorkbenchView("split");
    setBrowseDiagramZoom(100);
    if (catalogName) setRecentBrowse({ catalog: catalogName, category, groupId: value, scrollY: window.scrollY });
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
    }
  };

  const returnOneLevel = () => {
    if (groupId) {
      setGroupId("");
      if (catalogName) setRecentBrowse({ catalog: catalogName, category, groupId: "", scrollY: window.scrollY });
      window.setTimeout(() => assemblyListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
      return;
    }
    if (category !== "all") {
      setCategory("all");
      setGroupSearch("");
      if (catalogName) setRecentBrowse({ catalog: catalogName, category: "all", groupId: "", scrollY: window.scrollY });
      window.setTimeout(() => categorySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
      return;
    }
    chooseCatalog("");
  };

  const returnToCatalogLevel = () => {
    setCategory("all");
    setGroupSearch("");
    setGroupId("");
    if (catalogName) setRecentBrowse({ catalog: catalogName, category: "all", groupId: "", scrollY: window.scrollY });
    window.setTimeout(() => categorySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  };

  const returnToCategoryLevel = () => {
    setGroupId("");
    if (catalogName) setRecentBrowse({ catalog: catalogName, category, groupId: "", scrollY: window.scrollY });
    window.setTimeout(() => assemblyListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  };

  const resumeRecentBrowse = () => {
    if (!recentBrowse) return;
    setCatalogName(recentBrowse.catalog);
    setCategory(recentBrowse.category);
    setGroupId(recentBrowse.groupId);
    setPartSearch(recentBrowse.partSearch ?? "");
    setGroupSearch("");
    window.setTimeout(() => {
      const target = recentBrowse.groupId ? detailRef.current : recentBrowse.category !== "all" ? assemblyListRef.current : categorySectionRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const openPart = (partNumber: string, occurrenceGroupId = groupId) => onOpenPart(partNumber, {
    catalog: catalogName,
    category,
    groupId: occurrenceGroupId,
    partSearch,
    scrollY: window.scrollY,
  });

  if (!catalogName) {
    return <div className="catalogBrowseWorkspace">
      <section className="catalogPicker">
        <div className="catalogPickerHead">
          <div>
            <span>{he ? "שלב 1 מתוך 3" : "Step 1 of 3"}</span>
            <h2>{he ? "בחר קטלוג" : "Choose a catalog"}</h2>
            <p>{he ? "אפשר לבחור לפי דגם, שנה או סוג מנוע. אין צורך להזין מק״ט או מספר שלדה." : "Choose by model, year or engine type. No part number or VIN is required."}</p>
          </div>
          <input
            value={catalogSearch}
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder={he ? "סינון לפי דגם, שנה או מנוע..." : "Filter by model, year or engine..."}
            aria-label={he ? "סינון קטלוגים" : "Filter catalogs"}
          />
        </div>
        {recentBrowse && recentCatalog && <div className="recentCatalog">
          <div>
            <span>{he ? "המשך מהמקום האחרון" : "Continue where you left off"}</span>
            <strong>{recentCatalog.model || recentBrowse.catalog.match(/LCK[A-Z0-9]+/)?.[0] || recentBrowse.catalog}</strong>
            <small>{recentGroup?.title || (recentBrowse.category !== "all"
              ? (he ? CATEGORIES.find((item) => item.id === recentBrowse.category)?.he : CATEGORIES.find((item) => item.id === recentBrowse.category)?.en)
              : (he ? "בחירת מערכת" : "System selection"))}</small>
          </div>
          <button type="button" onClick={resumeRecentBrowse}>{he ? "המשך בקטלוג" : "Continue browsing"} <span aria-hidden="true">{he ? "←" : "→"}</span></button>
        </div>}
        <div className="catalogCardGrid">
          {catalogs.map((catalog) => (
            <button key={catalog.catalog} type="button" onClick={() => chooseCatalog(catalog.catalog)}>
              <span className="catalogModel">{catalog.model || catalog.catalog.match(/LCK[A-Z0-9]+/)?.[0] || (he ? "קטלוג Zhongtong" : "Zhongtong catalog")}</span>
              <strong>{[catalog.vehicleType, catalog.engine].filter(Boolean).join(" · ") || catalog.catalog}</strong>
              <small>{[
                catalog.year ? `${he ? "שנה" : "Year"} ${catalog.year}` : "",
                `${(catalog.parts ?? 0).toLocaleString(he ? "he-IL" : "en-US")} ${he ? "חלקים" : "parts"}`,
                `${catalog.vinNumbers?.length ?? catalog.vins ?? 0} ${he ? "שלדות" : "VINs"}`,
              ].filter(Boolean).join(" · ")}</small>
              <em>{he ? "פתח קטלוג ←" : "Open catalog →"}</em>
            </button>
          ))}
        </div>
        {!catalogs.length && <div className="browseEmpty">{he ? "לא נמצאו קטלוגים המתאימים לסינון." : "No catalogs match this filter."}</div>}
      </section>
    </div>;
  }

  const modelName = selectedCatalog?.model || catalogName.match(/LCK[A-Z0-9]+/)?.[0] || (he ? "קטלוג Zhongtong" : "Zhongtong catalog");

  return <div className="catalogBrowseWorkspace catalogBrowseWorkspaceActive">
    <nav className="catalogBrowseBreadcrumb" aria-label={he ? "מיקום בקטלוג" : "Catalog location"}>
      <button className="catalogBackButton" type="button" onClick={returnOneLevel}>
        <span aria-hidden="true">{he ? "→" : "←"}</span>
        <b>{groupId ? (he ? "חזרה לרשימת המכלולים" : "Back to assemblies") : category !== "all" ? (he ? "חזרה לכל המערכות" : "Back to all systems") : (he ? "חזרה לכל הקטלוגים" : "Back to all catalogs")}</b>
      </button>
      <ol>
        <li><button type="button" onClick={() => chooseCatalog("")}>{he ? "כל הקטלוגים" : "All catalogs"}</button></li>
        <li aria-hidden="true">›</li>
        <li><button type="button" onClick={returnToCatalogLevel}>{modelName}</button></li>
        {selectedCategory && <>
          <li aria-hidden="true">›</li>
          <li><button type="button" onClick={returnToCategoryLevel}>{he ? selectedCategory.he : selectedCategory.en}</button></li>
        </>}
        {selectedGroup && <>
          <li aria-hidden="true">›</li>
          <li aria-current="page"><strong>{selectedGroup.title || selectedGroup.code || (he ? "מכלול" : "Assembly")}</strong></li>
        </>}
      </ol>
    </nav>

    <section className="browseCatalogHeader">
      <div className="browseCatalogIdentity">
        <span>{he ? "קטלוג נבחר" : "Selected catalog"}</span>
        <h2>{modelName}</h2>
      </div>
      <div className="browseCatalogFacts">
        <span>
          <b>{he ? "שם הקטלוג" : "Catalog name"}</b>
          <strong dir="ltr">{catalogName}</strong>
        </span>
        <span>
          <b>{he ? "פרטי הקטלוג" : "Catalog details"}</b>
          <strong>{[selectedCatalog?.vehicleType, selectedCatalog?.year, selectedCatalog?.engine].filter(Boolean).join(" · ") || modelName}</strong>
        </span>
      </div>
      <button type="button" onClick={() => chooseCatalog("")}>{he ? "החלף קטלוג" : "Change catalog"}</button>
    </section>

    <section className={partSearch.trim() ? "catalogInlineSearch hasResults" : "catalogInlineSearch"}>
      <div className="catalogInlineSearchHead">
        <div>
          <span>{he ? "חיפוש בתוך הקטלוג הנבחר" : "Search inside this catalog"}</span>
          <h3>{he ? "מק״ט, תיאור או שם מכלול" : "Part number, description or assembly"}</h3>
          <small>{he ? `התוצאות מוגבלות ל־${modelName}; לא תועבר לקטלוג אחר.` : `Results stay inside ${modelName}; you will not be moved to another catalog.`}</small>
        </div>
        <div className="catalogInlineSearchBox">
          <ScanSearch size={19} aria-hidden="true" />
          <input
            value={partSearch}
            onChange={(event) => setPartSearch(event.target.value)}
            placeholder={he ? "לדוגמה: רפידות בלם או 2300-86..." : "For example: brake pads or 2300-86..."}
            aria-label={he ? "חיפוש חלק בתוך הקטלוג הנבחר" : "Search parts inside selected catalog"}
          />
          {partSearch && <button type="button" onClick={() => setPartSearch("")} aria-label={he ? "ניקוי החיפוש" : "Clear search"}><X size={16} /></button>}
        </div>
      </div>
      {partSearch.trim() && <div className="catalogInlineResults" aria-live="polite">
        <div className="catalogInlineResultsHead">
          <span>{catalogPartResults.length.toLocaleString(he ? "he-IL" : "en-US")} {he ? "מק״טים ייחודיים נמצאו בקטלוג זה" : "unique parts found in this catalog"}</span>
          <b><Sparkles size={13} aria-hidden="true" />{he ? "מדורג לפי התאמה" : "Ranked by relevance"}</b>
          {catalogPartResults.length > 80 && <small>{he ? "מוצגות 80 התוצאות הראשונות" : "Showing the first 80 results"}</small>}
        </div>
        <div className="catalogInlineResultList">
          {catalogPartResults.slice(0, 80).map((row) => (
            <div className="catalogInlineResult" key={row.part.partNumber}>
              <button type="button" onClick={() => openPart(row.part.partNumber, row.occurrence.groupId)}>
                <span className="catalogInlinePartIdentity"><b dir="ltr">{row.part.partNumber}</b><strong>{displayPartDescription(row.part, he, row.occurrence.description || (he ? "ללא תיאור" : "No description"))}</strong><span className="catalogInlineSmartMatch"><em className={`smartConfidence ${row.match.confidence}`}>{smartConfidenceLabel(row.match.confidence, he)}</em><small>{he ? row.match.reasonHe : row.match.reasonEn}</small></span></span>
                <span className="catalogInlineAssembly"><small>{he ? "מכלול" : "Assembly"}</small>{row.occurrence.assembly || (he ? "לא צוין" : "Not specified")}</span>
                <mark>{row.occurrence.position || "—"}</mark>
                {row.occurrenceCount > 1 && <em>{row.occurrenceCount} {he ? "מופעים בקטלוג" : "catalog matches"}</em>}
              </button>
              <CopyPartNumberButton partNumber={row.part.partNumber} he={he} compact />
            </div>
          ))}
          {!catalogPartResults.length && <div className="catalogInlineEmpty">{he ? "לא נמצא חלק מתאים בתוך הקטלוג הנבחר." : "No matching part was found inside the selected catalog."}</div>}
        </div>
      </div>}
    </section>

    <section className="browseCategorySection" ref={categorySectionRef}>
      <div className="browseSectionHead">
        <div><span>{he ? "שלב 2 מתוך 3" : "Step 2 of 3"}</span><h3>{he ? "בחר מערכת" : "Choose a system"}</h3></div>
        <b>{groups.length.toLocaleString(he ? "he-IL" : "en-US")} {he ? "מכלולים" : "assemblies"}</b>
      </div>
      <div className="browseCategoryGrid">
        <button type="button" className={category === "all" ? "active" : ""} onClick={() => chooseCategory("all")}>
          <span className="browseSystemIcon">☷</span><span>{he ? "כל המערכות" : "All systems"}</span><b>{groups.length}</b>
        </button>
        {CATEGORIES.map((item) => {
          const count = categoryCounts.get(item.id) ?? 0;
          if (!count) return null;
          return <button type="button" key={item.id} className={category === item.id ? "active" : ""} onClick={() => chooseCategory(item.id)}>
            <span className="browseSystemIcon"><SystemIcon category={item.id} /></span>
            <span>{he ? item.he : item.en}</span>
            <b>{count}</b>
          </button>;
        })}
      </div>
    </section>

    <div className="catalogBrowseGrid">
      <aside className="assemblyBrowseList" ref={assemblyListRef}>
        <div className="assemblyBrowseHead">
          <span>{he ? "שלב 3 מתוך 3" : "Step 3 of 3"}</span>
          <h3>{he ? "בחר מכלול או שרטוט" : "Choose an assembly or diagram"}</h3>
          <input
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
            placeholder={he ? "חיפוש מכלול..." : "Search assemblies..."}
            aria-label={he ? "חיפוש מכלול" : "Search assemblies"}
          />
        </div>
        <div className="assemblyBrowseRows">
          {visibleGroups.slice(0, 250).map((row) => (
            <button type="button" key={row.id} className={groupId === row.id ? "active" : ""} onClick={() => chooseGroup(row.id)} aria-current={groupId === row.id ? "true" : undefined}>
              <span>
                <b dir="ltr">{row.group.code || "—"}</b>
                <small>{row.group.title || (he ? "מכלול ללא כותרת" : "Untitled assembly")}</small>
              </span>
              <em>{row.group.parts.length} {he ? "חלקים" : "parts"} {row.group.figure ? "· ◫" : ""}</em>
            </button>
          ))}
          {!visibleGroups.length && <div className="browseEmpty">{he ? "לא נמצאו מכלולים מתאימים." : "No matching assemblies."}</div>}
          {visibleGroups.length > 250 && <div className="browseListNote">{he ? "מוצגים 250 המכלולים הראשונים. אפשר לצמצם בעזרת החיפוש." : "Showing the first 250 assemblies. Use search to narrow the list."}</div>}
        </div>
      </aside>

      <section className="assemblyBrowseDetail" ref={detailRef}>
        {!selectedGroup && <div className="browseDetailEmpty">
          <span aria-hidden="true">◫</span>
          <h3>{he ? "בחר מכלול מהרשימה" : "Choose an assembly from the list"}</h3>
          <p>{he ? "השרטוט ורשימת החלקים יופיעו כאן יחד." : "Its diagram and parts list will appear here together."}</p>
        </div>}
        {selectedGroup && <>
          <div className="browseDetailHead">
            <div>
              <span>{he ? "מכלול" : "Assembly"}</span>
              <h3>{selectedGroup.title || (he ? "מכלול ללא כותרת" : "Untitled assembly")}</h3>
              <div className="browseAssemblyContext">
                <b dir="ltr">{selectedGroup.code || "—"}</b>
                <small><span>{he ? "קטלוג" : "Catalog"}</span><strong dir="ltr">{catalogName}</strong></small>
              </div>
            </div>
            <div className="browseWorkbenchActions">
              <div className="workbenchViewSwitch" role="group" aria-label={he ? "תצוגת מכלול" : "Assembly view"}>
                <button type="button" aria-pressed={browseWorkbenchView === "split"} onClick={() => setBrowseWorkbenchView("split")}><Columns2 size={16} aria-hidden="true" />{he ? "מפוצל" : "Split"}</button>
                <button type="button" aria-pressed={browseWorkbenchView === "diagram"} onClick={() => setBrowseWorkbenchView("diagram")}><ImageIcon size={16} aria-hidden="true" />{he ? "שרטוט" : "Diagram"}</button>
                <button type="button" aria-pressed={browseWorkbenchView === "list"} onClick={() => setBrowseWorkbenchView("list")}><ListTree size={16} aria-hidden="true" />{he ? "רשימה" : "List"}</button>
              </div>
              <small>{selectedGroupParts.length} {he ? "מק״טים" : "part numbers"}</small>
            </div>
          </div>
          <div className={`browseFigureAndParts workbenchView-${browseWorkbenchView}`}>
            <div className="browseFigure">
              <div className="browseFigureToolbar">
                <span className="sourceTruth"><ShieldCheck size={14} aria-hidden="true" />{he ? "שרטוט היצרן" : "Manufacturer diagram"}</span>
                <div className="browseFigureToolActions">
                  {focusedGroupPart?.occurrence?.position && <span className="browseSelectedPosition">{he ? "מיקום" : "Position"} <b>{focusedGroupPart.occurrence.position}</b></span>}
                  <div className="diagramZoomControls" role="group" aria-label={he ? "שינוי גודל השרטוט" : "Diagram zoom"}>
                    <button type="button" onClick={() => setBrowseDiagramZoom((value) => Math.max(70, value - 10))} aria-label={he ? "הקטנת שרטוט" : "Zoom out"}><Minus size={15} /></button>
                    <output>{browseDiagramZoom}%</output>
                    <button type="button" onClick={() => setBrowseDiagramZoom((value) => Math.min(170, value + 10))} aria-label={he ? "הגדלת שרטוט" : "Zoom in"}><Plus size={15} /></button>
                    <button type="button" onClick={() => setBrowseDiagramZoom(100)} aria-label={he ? "איפוס גודל" : "Reset zoom"}><RotateCcw size={14} /></button>
                  </div>
                </div>
              </div>
              {selectedGroup.figure ? <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="browseFigureStage"><img src={selectedGroup.figure} alt={selectedGroup.title || selectedGroup.code} loading="lazy" decoding="async" style={{ width: `${browseDiagramZoom}%` }} /></div>
              </> : <div className="browseNoFigure"><b>{he ? "אין שרטוט זמין למכלול הזה" : "No diagram is available for this assembly"}</b><span>{he ? "רשימת החלקים עדיין מוצגת." : "The parts list is still available."}</span></div>}
            </div>
            <div className="browsePartsTable">
              <div className="browsePartsToolbar">
                <div><span>{he ? "רשימת חלקים" : "Parts list"}</span><strong>{visibleSelectedGroupParts.length} / {selectedGroupParts.length}</strong></div>
                <label>
                  <span className="srOnly">{he ? "חיפוש ברשימת החלקים" : "Search parts list"}</span>
                  <ScanSearch size={16} aria-hidden="true" />
                  <input value={assemblyPartSearch} onChange={(event) => setAssemblyPartSearch(event.target.value)} placeholder={he ? "מק״ט, תיאור או מיקום..." : "Part no., description or position..."} />
                </label>
              </div>
              <div className="browsePartsHead">
                <span>{he ? "מיקום" : "Pos."}</span><span>{he ? "מק״ט" : "Part no."}</span><span>{he ? "תיאור" : "Description"}</span>
              </div>
              <div
                className="browsePartsBody"
                tabIndex={0}
                aria-label={he ? "רשימת המק״טים במכלול" : "Assembly part numbers"}
              >
                {visibleSelectedGroupParts.map((row) => (
                  <div className="browsePartRowWithCopy" key={row.partNumber}>
                    <button type="button" className={focusedGroupPart?.partNumber === row.partNumber ? "browsePartRow selected" : "browsePartRow"} onClick={() => setFocusedPartNumber(row.partNumber)} aria-current={focusedGroupPart?.partNumber === row.partNumber ? "true" : undefined}>
                      <mark>{row.occurrence?.position || "—"}</mark>
                      <b dir="ltr">{row.partNumber}</b>
                      <span className="browsePartDescription">
                        <strong>{displayPartDescription(row.part, he, row.occurrence?.description || (he ? "ללא תיאור" : "No description"))}</strong>
                        {(row.occurrence?.quantity || row.occurrence?.notes) && <small>{[
                          row.occurrence?.quantity ? `${he ? "כמות" : "Qty"}: ${[row.occurrence.quantity, row.occurrence.unit].filter(Boolean).join(" ")}` : "",
                          row.occurrence?.notes || "",
                        ].filter(Boolean).join(" · ")}</small>}
                      </span>
                    </button>
                    <CopyPartNumberButton partNumber={row.partNumber} he={he} compact />
                  </div>
                ))}
                {!visibleSelectedGroupParts.length && <div className="browsePartsEmpty">{he ? "לא נמצאו חלקים במכלול לפי החיפוש הזה." : "No assembly parts match this search."}</div>}
              </div>
            </div>
          </div>
          {focusedGroupPart && <div className="browseSelectedPartDock">
            <div className="selectedPartPosition"><span>{he ? "מיקום" : "Position"}</span><strong>{focusedGroupPart.occurrence?.position || "—"}</strong></div>
            <div>
              <span>{he ? "החלק הנבחר במכלול" : "Selected assembly part"}</span>
              <strong dir="ltr">{focusedGroupPart.partNumber}</strong>
              <small>{displayPartDescription(focusedGroupPart.part, he, focusedGroupPart.occurrence?.description || (he ? "ללא תיאור" : "No description"))}</small>
            </div>
            <button type="button" onClick={() => openPart(focusedGroupPart.partNumber)}>{he ? "פתח כרטיס חלק" : "Open part card"}<span aria-hidden="true">{he ? "←" : "→"}</span></button>
          </div>}
        </>}
      </section>
    </div>
  </div>;
}

function VinSearchResult({ vin, catalog, data, he, onOpenPart, onTryMode, initialState }: {
  vin: string;
  catalog: Data["catalogs"][number] | null;
  data: Data;
  he: boolean;
  onOpenPart: (partNumber: string, vinState: VinBrowseState) => void;
  onTryMode: (mode: SearchMode) => void;
  initialState: VinBrowseState | null;
}) {
  const restored = initialState?.vin === vin ? initialState : null;
  const [category, setCategory] = useState<"all" | CategoryId>(restored?.category ?? "all");
  const [textFilter, setTextFilter] = useState(restored?.textFilter ?? "");
  const [visibleCount, setVisibleCount] = useState(restored?.visibleCount ?? 80);
  const [assistantQuery, setAssistantQuery] = useState(restored?.assistantQuery ?? "");
  const [messages, setMessages] = useState<AssistantMessage[]>(restored?.messages ?? [
    {
      role: "assistant",
      text: he
        ? "שלום, אני מחובר לקטלוג של השלדה הזאת. אפשר לשאול אותי בעברית על חלק, מק״ט, מיקום בשרטוט או מערכת ברכב."
        : "Hello, I am connected to this VIN catalog. Ask me about a part, part number, diagram position, or vehicle system.",
    },
  ]);
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = assistantMessagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const rows = useMemo(() => {
    if (!catalog) return [];
    return data.parts.flatMap((part) => {
      const occurrences = part.occurrences.filter((item) => item.catalog === catalog.catalog);
      if (!occurrences.length) return [];
      const occurrence = occurrences.find((item) => item.position) ?? occurrences[0];
      return [{
        part,
        occurrence,
        occurrenceCount: occurrences.length,
        category: categoryFor(part, occurrence),
      }];
    }).sort((a, b) => a.part.partNumber.localeCompare(b.part.partNumber));
  }, [catalog, data.parts]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    rows.forEach((row) => counts.set(row.category, (counts.get(row.category) ?? 0) + 1));
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const scopedRows = rows
      .filter((row) => category === "all" || row.category === category)
      .map((row) => ({ ...row, smartMatch: undefined as SmartMatch | undefined }));
    if (!textFilter.trim()) return scopedRows;
    const analysis = analyzeSmartQuery(textFilter);
    return scopedRows.flatMap((row) => {
      const catalogOccurrences = row.part.occurrences.filter((occurrence) => occurrence.catalog === catalog?.catalog);
      const ranked = rankSmartPart(row.part, analysis, catalogOccurrences);
      return ranked ? [{ ...row, occurrence: ranked.occurrence, occurrenceCount: ranked.occurrenceCount, smartMatch: ranked.match }] : [];
    }).sort((left, right) => (right.smartMatch?.score ?? 0) - (left.smartMatch?.score ?? 0)
      || left.part.partNumber.localeCompare(right.part.partNumber));
  }, [rows, category, textFilter, catalog?.catalog]);

  const selectCategory = (value: "all" | CategoryId) => {
    setCategory(value);
    setTextFilter("");
    setVisibleCount(80);
  };

  const applyTextFilter = (value: string) => {
    setCategory("all");
    setTextFilter(value);
    setVisibleCount(80);
  };

  const askAssistant = (value = assistantQuery) => {
    const raw = value.trim();
    if (!raw) return;
    const question = raw.toLowerCase();
    let response = "";
    let resultRows: typeof rows = [];
    let suggestions: string[] | undefined;
    const matchedCategory = CATEGORIES.find((item) => item.aliases.some((alias) => question.includes(alias)));
    const explicitRow = rows.find((row) => normalize(raw).includes(normalize(row.part.partNumber)));
    const partNumber = explicitRow?.part.partNumber ?? raw.toUpperCase().match(/[A-Z0-9]{2,}(?:-[A-Z0-9]+){1,}/)?.[0];
    const smartRule = findSmartSearchRule(question);
    const previousResultMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.results?.length);
    const previousRows = (previousResultMessage?.results ?? [])
      .map((result) => rows.find((row) => row.part.partNumber === result.partNumber))
      .filter((row): row is typeof rows[number] => Boolean(row));
    const asksForReplacement = /תחליף|חלופי|החלפה|הוחלף|מחליף|replacement|replace|supersession/.test(question);
    const asksForDiagram = /שרטוט|דיאגרמה|diagram|drawing/.test(question);
    const asksForLocation = /איפה|היכן|מיקום|מספר.*שרטוט|where|position/.test(question);
    const asksForPartNumber = /מה.*מק.?ט|איזה.*מק.?ט|מספר.*חלק|part number/.test(question);
    const isLeftFollowUp = /^(צד\s*)?(שמאל|שמאלי|שמאלית|left|lh)$/.test(question);
    const isRightFollowUp = /^(צד\s*)?(ימין|ימני|ימנית|right|rh)$/.test(question);
    const hasSideInQuestion = /שמאל|ימין|\bleft\b|\bright\b|\blh\b|\brh\b/.test(question);
    const assistantMatchByPart = new Map<string, SmartMatch>();
    const rankRowsForQuestion = (searchValue: string) => {
      const analysis = analyzeSmartQuery(searchValue);
      return rows.flatMap((row) => {
        const catalogOccurrences = row.part.occurrences.filter((occurrence) => occurrence.catalog === catalog?.catalog);
        const ranked = rankSmartPart(row.part, analysis, catalogOccurrences.length ? catalogOccurrences : [row.occurrence]);
        return ranked ? [{ row: { ...row, occurrence: ranked.occurrence, occurrenceCount: ranked.occurrenceCount }, match: ranked.match }] : [];
      }).sort((left, right) => right.match.score - left.match.score
        || left.row.part.partNumber.localeCompare(right.row.part.partNumber));
    };
    const toAssistantResult = (row: typeof rows[number]): AssistantPartResult => ({
      partNumber: row.part.partNumber,
      description: displayPartDescription(row.part, he, he ? "ללא תיאור" : "No description"),
      assembly: row.occurrence.assembly || (he ? "לא צוין" : "Not specified"),
      position: row.occurrence.position || "—",
      confidence: assistantMatchByPart.get(row.part.partNumber)?.confidence,
      reason: assistantMatchByPart.get(row.part.partNumber)?.[he ? "reasonHe" : "reasonEn"],
    });
    const completeConversation = () => {
      setMessages((current) => [
        ...current,
        { role: "user", text: raw },
        {
          role: "assistant",
          text: response,
          results: resultRows.slice(0, 6).map(toAssistantResult),
          suggestions,
        },
      ]);
      setAssistantQuery("");
    };

    if ((isLeftFollowUp || isRightFollowUp) && previousRows.length) {
      resultRows = previousRows.filter((row) => {
        const description = `${row.part.description} ${row.occurrence.assembly}`;
        return isLeftFollowUp ? isLeftDescription(description) : isRightDescription(description);
      });
      response = resultRows.length
        ? (he
          ? `מצאתי ${resultRows.length === 1 ? "חלק מתאים אחד" : `${resultRows.length} חלקים מתאימים`} לצד ${isLeftFollowUp ? "שמאל" : "ימין"}.`
          : `I found ${resultRows.length} matching ${isLeftFollowUp ? "left-side" : "right-side"} part${resultRows.length === 1 ? "" : "s"}.`)
        : (he
          ? `לא מצאתי בין התוצאות הקודמות חלק שמסומן כצד ${isLeftFollowUp ? "שמאל" : "ימין"}.`
          : `None of the previous results is marked for the ${isLeftFollowUp ? "left" : "right"} side.`);
      if (resultRows.length === 1) applyTextFilter(resultRows[0].part.partNumber);
    } else if (asksForReplacement) {
      const targetRow = explicitRow ?? (previousRows.length === 1 ? previousRows[0] : undefined);
      resultRows = targetRow ? [targetRow] : [];
      response = he
        ? targetRow
          ? `בנתוני היצרן שקיימים באתר אין שדה של החלפה רשמית עבור ${targetRow.part.partNumber}. לכן איני יכול לאשר חלק חלופי מהקטלוג הזה בלבד.`
          : "כדי לבדוק החלפה, כתוב את המק״ט. חשוב: המאגר הנוכחי אינו כולל טבלת החלפות רשמית, ולכן לא אמציא מק״ט חלופי."
        : targetRow
          ? `The manufacturer data in this site has no official replacement field for ${targetRow.part.partNumber}, so I cannot confirm a supersession from this catalog alone.`
          : "Enter the part number to check. This database has no official supersession table, so I will not invent a replacement.";
    } else if (asksForDiagram && !smartRule && !matchedCategory) {
      const targetRows = explicitRow ? [explicitRow] : previousRows;
      resultRows = targetRows;
      if (targetRows.length === 1) {
        response = he
          ? `מצאתי את החלק. לחץ על „פתח שרטוט” כדי לעבור למיקום ${targetRows[0].occurrence.position || "שלא צוין"} בשרטוט.`
          : `I found the part. Select “Open diagram” to view position ${targetRows[0].occurrence.position || "not specified"}.`;
      } else if (targetRows.length > 1) {
        response = he
          ? "יש כמה תוצאות אפשריות. בחר את המק״ט הרצוי מהרשימה כדי לפתוח את השרטוט הנכון."
          : "There are several possible results. Choose a part number below to open the correct diagram.";
      } else {
        response = he
          ? "על איזה חלק תרצה לראות שרטוט? אפשר לכתוב שם חלק או מק״ט."
          : "Which part would you like to see in a diagram? Enter a description or part number.";
        suggestions = he ? ["מנוע המגב", "שמשה קדמית", "רפידות בלם"] : ["Wiper motor", "Front windshield", "Brake pads"];
      }
    } else if (/כמה.*חלק|how many.*part/.test(question)) {
      response = he
        ? `בקטלוג של השלדה נמצאו ${rows.length.toLocaleString("he-IL")} מק״טים ייחודיים ב־${categoryCounts.size} קטגוריות.`
        : `The VIN catalog contains ${rows.length.toLocaleString("en-US")} unique parts across ${categoryCounts.size} categories.`;
    } else if (partNumber) {
      resultRows = rows.filter((row) => normalize(row.part.partNumber).includes(normalize(partNumber)));
      const exists = resultRows.length > 0;
      applyTextFilter(partNumber);
      response = exists
        ? (he
          ? `מצאתי את ${partNumber} בקטלוג. ${asksForLocation ? `המיקום בשרטוט הוא ${resultRows[0].occurrence.position || "לא צוין"}, במכלול „${resultRows[0].occurrence.assembly || "לא צוין"}”.` : "אפשר לפתוח את כרטיס החלק והשרטוט ישירות מכאן."}`
          : `I found ${partNumber} in the catalog. ${asksForLocation ? `Its diagram position is ${resultRows[0].occurrence.position || "not specified"} in “${resultRows[0].occurrence.assembly || "not specified"}”.` : "You can open the part card and diagram directly from here."}`)
        : (he ? `המק״ט ${partNumber} לא נמצא בקטלוג המשויך לשלדה הזאת.` : `${partNumber} was not found in the catalog linked to this VIN.`);
    } else if (smartRule) {
      const rankedCandidates = rankRowsForQuestion(raw);
      rankedCandidates.forEach((candidate) => assistantMatchByPart.set(candidate.row.part.partNumber, candidate.match));
      resultRows = rankedCandidates.map((candidate) => candidate.row);
      const count = resultRows.length;
      if (count) applyTextFilter(raw);
      const hasLeft = resultRows.some((row) => isLeftDescription(`${row.part.description} ${row.occurrence.assembly}`));
      const hasRight = resultRows.some((row) => isRightDescription(`${row.part.description} ${row.occurrence.assembly}`));
      if (count && hasLeft && hasRight && !hasSideInQuestion) {
        response = he
          ? `מצאתי חלקים מתאימים ל־${smartRule.he} בשני הצדדים. איזה צד אתה צריך?`
          : `I found matching ${smartRule.en} parts for both sides. Which side do you need?`;
        suggestions = he ? ["צד שמאל", "צד ימין"] : ["Left", "Right"];
      } else {
        response = count
          ? (he
            ? count === 1
              ? `מצאתי התאמה אחת ל־${smartRule.he}: מק״ט ${resultRows[0].part.partNumber}${asksForLocation ? `, מיקום ${resultRows[0].occurrence.position || "לא צוין"} בשרטוט` : ""}.`
              : `מצאתי ${count.toLocaleString("he-IL")} התאמות ל־${smartRule.he}. מוצגות כאן ${Math.min(count, 6)} התוצאות הראשונות; אפשר לבחור מק״ט או לדייק את השאלה.`
            : `I found ${count.toLocaleString("en-US")} matching ${smartRule.en} part${count === 1 ? "" : "s"}.`)
          : (he
            ? `הבנתי שאתה מחפש ${smartRule.he}, אבל לא מצאתי חלק מתאים בקטלוג של השלדה הזאת.`
            : `I understood “${smartRule.en}”, but found no matching part in this VIN catalog.`);
      }
    } else if (matchedCategory) {
      selectCategory(matchedCategory.id);
      const count = categoryCounts.get(matchedCategory.id) ?? 0;
      response = he
        ? `הצגתי ${count.toLocaleString("he-IL")} חלקים בקטגוריית „${matchedCategory.he}”.`
        : `Showing ${count.toLocaleString("en-US")} parts in “${matchedCategory.en}”.`;
    } else {
      const rankedCandidates = rankRowsForQuestion(raw);
      rankedCandidates.forEach((candidate) => assistantMatchByPart.set(candidate.row.part.partNumber, candidate.match));
      resultRows = rankedCandidates.map((candidate) => candidate.row);
      if (resultRows.length) applyTextFilter(raw);
      response = resultRows.length
        ? (he
          ? `${asksForPartNumber ? "מצאתי את המק״טים המתאימים." : `מצאתי ${resultRows.length.toLocaleString("he-IL")} תוצאות ודירגתי אותן לפי עוצמת ההתאמה.`} ${resultRows.length > 6 ? "מוצגות כאן 6 התוצאות החזקות ביותר." : "אפשר לפתוח כל תוצאה ישירות."}`
          : `I found ${resultRows.length.toLocaleString("en-US")} match${resultRows.length === 1 ? "" : "es"}, ranked by relevance. You can open a result directly.`)
        : (he
          ? "לא מצאתי התאמה בקטלוג של השלדה הזאת. נסה לנסח את שם החלק בצורה אחרת או הזן מק״ט."
          : "I found no match in this VIN catalog. Try another part description or enter a part number.");
    }

    completeConversation();
  };

  if (!catalog) {
    const validLength = normalizeVin(vin).length === 17;
    const searchableCatalogs = data.catalogs.filter((item) => item.vinNumbers?.length).length;
    return <section className="vinNotFound">
      <div className="vinNotFoundIcon">VIN</div>
      <h2>{validLength ? (he ? "מספר השלדה לא נמצא במאגר" : "VIN not found in the database") : (he ? "מספר השלדה אינו מלא" : "VIN is incomplete")}</h2>
      <p>{validLength
        ? (he ? `המאגר הנוכחי כולל ${data.catalogs.reduce((sum, item) => sum + (item.vinNumbers?.length ?? 0), 0)} שלדות מתוך ${searchableCatalogs} קטלוגים. ייתכן שהקטלוג קיים אך לא צורפה אליו רשימת VIN.` : `The current database covers ${data.catalogs.reduce((sum, item) => sum + (item.vinNumbers?.length ?? 0), 0)} VINs across ${searchableCatalogs} catalogs. The catalog may exist without an attached VIN list.`)
        : (he ? "יש להזין 17 תווים, ללא רווחים." : "Enter all 17 characters without spaces.")}</p>
      <code>{vin}</code>
      <div className="vinNotFoundActions">
        <button type="button" onClick={() => onTryMode("part")}>{he ? "חיפוש לפי מק״ט" : "Search by part number"}</button>
        <button type="button" onClick={() => onTryMode("browse")}>{he ? "שיטוט בקטלוגים" : "Browse catalogs"}</button>
      </div>
    </section>;
  }

  const firstOccurrence = rows[0]?.occurrence;
  const modelName = firstOccurrence?.model || catalog.catalog.match(/LCK[A-Z0-9]+/)?.[0] || (he ? "לא צוין" : "Not specified");
  const catalogVinCount = catalog.vinNumbers?.length ?? 0;
  const activeCategory = category === "all" ? null : CATEGORIES.find((item) => item.id === category);
  const openPartWithContext = (partNumber: string) => {
    onOpenPart(partNumber, {
      vin,
      category,
      textFilter,
      visibleCount,
      assistantQuery,
      messages,
      scrollY: window.scrollY,
    });
  };

  return <div className="vinWorkspace">
    <section className="vinHeaderCard">
      <div className="vinIdentity">
        <span>{he ? "מספר שלדה" : "VIN"}</span>
        <h2 dir="ltr">{vin}</h2>
        <div className="vinMeta">
          <span><b>{he ? "דגם" : "Model"}</b>{modelName}</span>
          <span><b>{he ? "שנת קטלוג" : "Catalog year"}</b>{firstOccurrence?.year || (he ? "לא צוינה" : "Not specified")}</span>
          <span><b>{he ? "חלקים בקטלוג" : "Catalog parts"}</b>{rows.length.toLocaleString(he ? "he-IL" : "en-US")}</span>
          <span className="vinCatalogName"><b>{he ? "שם הקטלוג" : "Catalog name"}</b><strong dir="ltr">{catalog.catalog}</strong></span>
        </div>
      </div>
      <div className="catalogAccuracy">
        <strong>{he ? "חשוב לדעת" : "Good to know"}</strong>
        <p>{he
          ? `השלדה משויכת לקטלוג משותף ל־${catalogVinCount} שלדות. מוצגים כל החלקים האפשריים בקטלוג; ייתכנו הבדלי אבזור בין שלדות.`
          : `This VIN is linked to a catalog shared by ${catalogVinCount} chassis. All possible catalog parts are shown; equipment may vary between vehicles.`}</p>
      </div>
    </section>

    <section className="categorySection">
      <div className="vinSectionHeading">
        <div><span>{he ? "שלב 1" : "Step 1"}</span><h3>{he ? "בחר מערכת" : "Choose a system"}</h3></div>
        <button className={category === "all" ? "active" : ""} onClick={() => selectCategory("all")}>{he ? `כל ${rows.length.toLocaleString("he-IL")} החלקים` : `All ${rows.length.toLocaleString("en-US")} parts`}</button>
      </div>
      <div className="categoryGrid">
        {CATEGORIES.filter((item) => categoryCounts.get(item.id)).map((item) => {
          return (
            <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => selectCategory(item.id)}>
              <span className="categoryIcon" aria-hidden="true"><SystemIcon category={item.id} /></span>
              <span className="categoryLabel">{he ? item.he : item.en}</span>
              <b>{(categoryCounts.get(item.id) ?? 0).toLocaleString(he ? "he-IL" : "en-US")}</b>
            </button>
          );
        })}
      </div>
    </section>

    <div className="vinContentGrid">
      <section className="vinPartsCard">
        <div className="vinPartsToolbar">
          <div>
            <span>{he ? "שלב 2" : "Step 2"}</span>
            <h3>{activeCategory ? (he ? activeCategory.he : activeCategory.en) : (he ? "כל חלקי הקטלוג" : "All catalog parts")}</h3>
            <small>{he
              ? (filteredRows.length === 1 ? "תוצאה אחת" : `${filteredRows.length.toLocaleString("he-IL")} תוצאות`)
              : `${filteredRows.length.toLocaleString("en-US")} result${filteredRows.length === 1 ? "" : "s"}`}</small>
          </div>
          <label className="vinContextSearch">
            <span><Sparkles size={13} aria-hidden="true" />{he ? "חיפוש חכם בתוך הקטלוג של השלדה" : "Smart search inside this VIN catalog"}</span>
            <span className="vinContextSearchBox"><ScanSearch size={17} aria-hidden="true" /><input
              value={textFilter}
              onChange={(event) => { setTextFilter(event.target.value); setVisibleCount(80); }}
              placeholder={he ? "מק״ט, תיאור או מכלול — גם בעברית" : "Part number, description or assembly"}
              aria-label={he ? "חיפוש חלק בתוך קטלוג השלדה" : "Search inside VIN catalog"}
            />{textFilter && <button type="button" onClick={() => { setTextFilter(""); setVisibleCount(80); }} aria-label={he ? "ניקוי החיפוש" : "Clear search"}><X size={15} /></button>}</span>
          </label>
        </div>

        <div className="vinPartsTable" role="table" aria-label={he ? "חלקי השלדה" : "VIN parts"} aria-live="polite">
          <div className="vinPartsTableHead" role="row">
            <span>{he ? "מק״ט ותיאור" : "Part & description"}</span>
            <span>{he ? "מכלול" : "Assembly"}</span>
            <span>{he ? "מיקום" : "Position"}</span>
            <span />
          </div>
          {filteredRows.slice(0, visibleCount).map((row) => (
            <div className="vinPartRow" role="row" key={row.part.partNumber}>
              <div><span className="partNumberCopyLine"><b dir="ltr">{row.part.partNumber}</b><CopyPartNumberButton partNumber={row.part.partNumber} he={he} compact /></span><span>{displayPartDescription(row.part, he, he ? "ללא תיאור" : "No description")}</span>{row.smartMatch && <span className="vinSmartMatch"><em className={`smartConfidence ${row.smartMatch.confidence}`}>{smartConfidenceLabel(row.smartMatch.confidence, he)}</em><small>{he ? row.smartMatch.reasonHe : row.smartMatch.reasonEn}</small></span>}</div>
              <div><span>{row.occurrence.assembly || (he ? "לא צוין" : "Not specified")}</span>{row.occurrenceCount > 1 && <small>{row.occurrenceCount} {he ? "הופעות" : "matches"}</small>}</div>
              <div><mark>{row.occurrence.position || "—"}</mark></div>
              <button onClick={() => openPartWithContext(row.part.partNumber)}>{he ? "פתח חלק" : "Open part"}<span aria-hidden="true">{he ? "←" : "→"}</span></button>
            </div>
          ))}
          {!filteredRows.length && <div className="vinListEmpty">{he ? "לא נמצאו חלקים המתאימים לסינון." : "No parts match this filter."}</div>}
        </div>
        {visibleCount < filteredRows.length && <button className="loadMore" onClick={() => setVisibleCount((count) => count + 80)}>
          {he ? `הצג עוד (${filteredRows.length - visibleCount} נותרו)` : `Show more (${filteredRows.length - visibleCount} remaining)`}
        </button>}
      </section>

      <aside className="catalogAssistant">
        <div className="assistantHead">
          <div className="assistantAvatar" aria-hidden="true">Z</div>
          <div>
            <span>{he ? "עוזר קטלוג חכם" : "Smart catalog assistant"}</span>
            <small>{he ? `מחובר לשלדה ולדגם ${modelName}` : `Connected to this VIN and ${modelName}`}</small>
          </div>
        </div>
        <div className="assistantMessages" aria-live="polite" ref={assistantMessagesRef}>
          {messages.map((message, index) => (
            <div className={`assistantMessage ${message.role}`} key={`${message.role}-${index}`}>
              <p>{message.text}</p>
              {message.results?.length ? <div className="assistantResults">
                {message.results.map((result) => (
                  <div className="assistantResultWithCopy" key={result.partNumber}>
                    <button type="button" onClick={() => openPartWithContext(result.partNumber)}>
                      <span className="assistantResultTitle">
                        <b dir="ltr">{result.partNumber}</b>
                        <mark>{he ? "מס׳" : "Pos."} {result.position}</mark>
                      </span>
                      <span className="assistantResultDescription">{result.description}</span>
                      {result.confidence && <span className="assistantMatchReason"><em className={`smartConfidence ${result.confidence}`}>{smartConfidenceLabel(result.confidence, he)}</em>{result.reason && <small>{result.reason}</small>}</span>}
                      <small>{result.assembly}</small>
                      <em>{he ? "פתח שרטוט ופרטי חלק" : "Open diagram and part details"} <span aria-hidden="true">{he ? "←" : "→"}</span></em>
                    </button>
                    <CopyPartNumberButton partNumber={result.partNumber} he={he} compact />
                  </div>
                ))}
              </div> : null}
              {message.suggestions?.length ? <div className="assistantReplies">
                {message.suggestions.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => askAssistant(suggestion)}>{suggestion}</button>
                ))}
              </div> : null}
            </div>
          ))}
        </div>
        <div className="assistantSuggestions">
          {(he
            ? ["איפה מנוע המגב?", "מה המק״ט של רפידות הבלם?", "שמשה קדמית", "כמה חלקים יש?"]
            : ["Where is the wiper motor?", "Brake pad part number", "Front windshield", "How many parts?"]
          ).map((suggestion) => (
            <button key={suggestion} onClick={() => askAssistant(suggestion)}>{suggestion}</button>
          ))}
        </div>
        <form className="assistantInput" onSubmit={(event) => { event.preventDefault(); askAssistant(); }}>
          <input value={assistantQuery} onChange={(event) => setAssistantQuery(event.target.value)} placeholder={he ? "שאל שאלה על חלק..." : "Ask a question about a part..."} aria-label={he ? "שאלה לעוזר הקטלוג" : "Question for catalog assistant"} />
          <button type="submit" aria-label={he ? "שליחה" : "Send"}>↑</button>
        </form>
        <p className="assistantNote">{he ? "התשובות מבוססות רק על קטלוג היצרן המשויך לשלדה. נתוני מלאי והחלפות רשמיות אינם כלולים כרגע." : "Answers use only the manufacturer catalog linked to this VIN. Stock and official supersession data are not currently included."}</p>
      </aside>
    </div>
  </div>;
}

function PartDetail({ part, groups, partIndex, catalogVins, preferredCatalog, preferredGroupId, onSearch, onBrowseLocation, he }: {
  part: Part;
  groups: Data["groups"];
  partIndex: Map<string, Part>;
  catalogVins: Map<string, string[]>;
  preferredCatalog?: string;
  preferredGroupId?: string;
  onSearch: (value: string) => void;
  onBrowseLocation: (part: Part, occurrence: Occurrence, level: "catalogs" | "catalog" | "assembly") => void;
  he: boolean;
}) {
  const scopedOccurrences = preferredCatalog
    ? part.occurrences.filter((occurrence) => occurrence.catalog === preferredCatalog)
    : part.occurrences;
  const availableOccurrences = scopedOccurrences.length ? scopedOccurrences : part.occurrences;
  const preferredOccurrenceIndex = preferredGroupId
    ? availableOccurrences.findIndex((occurrence) => occurrence.groupId === preferredGroupId)
    : -1;
  const [activeOccurrence, setActiveOccurrence] = useState(Math.max(0, preferredOccurrenceIndex));
  const [activeDetailTab, setActiveDetailTab] = useState<PartDetailTab>("diagram");
  const [showAllVins, setShowAllVins] = useState(false);
  const [figureOpen, setFigureOpen] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>("split");
  const [assemblySearch, setAssemblySearch] = useState("");
  const [diagramZoom, setDiagramZoom] = useState(100);
  const [photos, setPhotos] = useState<RealPartPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [canManagePhotos, setCanManagePhotos] = useState(false);
  const [photoViewerSignedIn, setPhotoViewerSignedIn] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSource, setUploadSource] = useState<RealPartPhoto["source"]>("warehouse");
  const [uploadVin, setUploadVin] = useState("");
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [openPhoto, setOpenPhoto] = useState<RealPartPhoto | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<RealPartPhoto | null>(null);
  const [editSource, setEditSource] = useState<RealPartPhoto["source"]>("warehouse");
  const [editVin, setEditVin] = useState("");
  const [editStatus, setEditStatus] = useState<RealPartPhoto["status"]>("pending");
  const [editReplacementFile, setEditReplacementFile] = useState<File | null>(null);
  const [editPreparing, setEditPreparing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [shareFeedback, setShareFeedback] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const editReplacementInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const detailTabsRef = useRef<HTMLDivElement>(null);
  const active = availableOccurrences[activeOccurrence] ?? availableOccurrences[0];
  const activeGroup = active ? groups[active.groupId] : undefined;
  const allVins = [...new Set(availableOccurrences.flatMap((o) => catalogVins.get(o.catalog) ?? []))];
  const scopedModels = [...new Set(availableOccurrences.map((occurrence) => occurrence.model).filter(Boolean))];
  const scopedYears = [...new Set(availableOccurrences.map((occurrence) => occurrence.year).filter(Boolean))];
  const assemblyParts = [...new Set(activeGroup?.parts ?? [part.partNumber])]
    .map((partNumber) => {
      const assemblyPart = partNumber === part.partNumber ? part : partIndex.get(partNumber);
      const occurrence = assemblyPart?.occurrences.find((item) => item.groupId === active?.groupId);
      return {
        partNumber,
        description: displayPartDescription(assemblyPart, he, occurrence?.description || (he ? "ללא תיאור" : "No description")),
        position: occurrence?.position || (partNumber === part.partNumber ? active?.position || "" : ""),
        quantity: occurrence?.quantity || "",
        unit: occurrence?.unit || "",
        notes: occurrence?.notes || "",
        selected: partNumber === part.partNumber,
      };
    })
    .sort((a, b) => compareDiagramPositions(a.position, b.position)
      || a.partNumber.localeCompare(b.partNumber));
  const visibleAssemblyParts = assemblyParts.filter((item) => !assemblySearch.trim() || matchesSearch([
    item.partNumber,
    item.description,
    item.position,
    item.quantity,
    item.unit,
    item.notes,
  ].join(" "), assemblySearch));
  const related = assemblyParts.filter((item) => !item.selected).slice(0, 40);
  const chooseOccurrence = (index: number) => {
    setActiveOccurrence(index);
    setAssemblySearch("");
    setWorkbenchView("split");
    setDiagramZoom(100);
  };
  const openDetailTab = (tab: PartDetailTab) => {
    setActiveDetailTab(tab);
    window.requestAnimationFrame(() => {
      detailTabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const sharePart = async () => {
    const title = `${part.partNumber} · ${displayPartDescription(part, he, "Zhongtong part")}`;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url });
        setShareFeedback(he ? "קישור החלק שותף." : "Part link shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setShareFeedback(he ? "הקישור הועתק." : "Link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareFeedback(he ? "לא הצלחנו לשתף. אפשר להעתיק את הכתובת משורת הדפדפן." : "Sharing failed. Copy the address from the browser bar.");
    }
    window.setTimeout(() => setShareFeedback(""), 2200);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/photos?partNumber=${encodeURIComponent(part.partNumber)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<{ photos: RealPartPhoto[]; canManage: boolean; signedIn: boolean }>;
      })
      .then((result) => {
        setPhotos(result.photos);
        setCanManagePhotos(result.canManage);
        setPhotoViewerSignedIn(result.signedIn);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhotoError(he ? "לא ניתן לטעון כרגע את התמונות." : "Photos are currently unavailable.");
      })
      .finally(() => setPhotosLoading(false));
    return () => controller.abort();
  }, [part.partNumber, he]);

  useEffect(() => {
    if (!cameraOpen || !cameraVideoRef.current || !cameraStreamRef.current) return;
    cameraVideoRef.current.srcObject = cameraStreamRef.current;
    cameraVideoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
  }, [part.partNumber]);

  const sourceLabel = (source: RealPartPhoto["source"]) => {
    if (source === "warehouse") return he ? "צולם במחסן" : "Warehouse photo";
    if (source === "manufacturer") return he ? "התקבל מהיצרן" : "From manufacturer";
    if (source === "workshop") return he ? "מהמוסך או מהלקוח" : "Workshop or customer";
    return he ? "מקור אחר" : "Other source";
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraStarting(false);
  };

  const startCamera = async () => {
    setPhotoError("");
    setCameraStarting(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStarting(false);
      cameraInputRef.current?.click();
      return;
    }

    try {
      stopCamera();
      setCameraStarting(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setPhotoError(he
        ? "לא ניתן לפתוח את המצלמה. יש לאשר לאתר גישה למצלמה בהגדרות הדפדפן ולנסות שוב."
        : "The camera could not be opened. Allow camera access in the browser settings and try again.");
    } finally {
      setCameraStarting(false);
    }
  };

  const capturePhoto = async () => {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setPhotoError(he ? "המצלמה עדיין נטענת. נסה שוב בעוד רגע." : "The camera is still loading. Try again in a moment.");
      return;
    }

    const maxWidth = 1920;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setPhotoError(he ? "לא ניתן היה לצלם את התמונה. נסה שוב." : "The photo could not be captured. Try again.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      setPhotoError(he ? "לא ניתן היה לצלם את התמונה. נסה שוב." : "The photo could not be captured. Try again.");
      return;
    }

    const safePartNumber = part.partNumber.replace(/[^A-Z0-9_-]/gi, "_");
    const capturedFile = new File([blob], `${safePartNumber}_${Date.now()}.jpg`, { type: "image/jpeg" });
    setPreparingPhoto(true);
    try {
      setUploadFile(await preparePhotoFile(capturedFile, part.partNumber));
      setUploadSource("warehouse");
      setPhotoError("");
      stopCamera();
    } catch {
      setPhotoError(he ? "לא ניתן להכין את התמונה לשמירה. נסה לצלם מחדש." : "The image could not be prepared. Try taking it again.");
    } finally {
      setPreparingPhoto(false);
    }
  };

  const selectPhotoFile = async (file: File | null) => {
    setUploadFile(null);
    setPhotoError("");
    if (!file) return;

    setPreparingPhoto(true);
    try {
      setUploadFile(await preparePhotoFile(file, part.partNumber));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "type") {
        setPhotoError(he ? "יש לבחור קובץ תמונה." : "Choose an image file.");
      } else if (reason === "original-size") {
        setPhotoError(he ? "התמונה המקורית גדולה מדי. ניתן לבחור תמונה עד 20MB." : "The original image is too large. Choose an image up to 20 MB.");
      } else {
        setPhotoError(he ? "לא ניתן להכין את התמונה לשמירה. נסה לצלם מחדש." : "The image could not be prepared. Try taking it again.");
      }
    } finally {
      setPreparingPhoto(false);
    }
  };

  const uploadPhoto = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploadFile) {
      setPhotoError(he ? "יש לבחור תמונה לפני השמירה." : "Choose an image before saving.");
      return;
    }
    if (uploadFile.size > MAX_PREPARED_PHOTO_BYTES) {
      setPhotoError(he ? "התמונה עדיין גדולה מדי לשמירה. נסה לצלם מחדש." : "The image is still too large to save. Try taking it again.");
      return;
    }

    setUploading(true);
    setPhotoError("");
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("partNumber", part.partNumber);
    form.append("source", uploadSource);
    form.append("vin", uploadVin);
    form.append("status", "pending");

    try {
      const response = await fetch("/api/photos", { method: "POST", body: form });
      const result = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as { photo?: RealPartPhoto; error?: string }
        : { error: await response.text() };
      if (response.status === 413) {
        setPhotoError(he ? "התמונה גדולה מדי לשמירה. נסה לצלם מחדש או לבחור תמונה אחרת." : "The image is too large to save. Take it again or choose another image.");
        return;
      }
      if (response.status === 403) {
        setPhotoError(he ? "השמירה נחסמה. רענן את האתר ונסה שוב." : "Saving was blocked. Refresh the site and try again.");
        return;
      }
      if (response.status === 400 || response.status === 415) {
        setPhotoError(he ? "הקובץ שנבחר אינו תמונה נתמכת. נסה לצלם מחדש או לבחור JPG, PNG או WebP." : "The selected file is not a supported image. Take it again or choose a JPG, PNG, or WebP file.");
        return;
      }
      if (response.status >= 500) {
        setPhotoError(he ? "שירות שמירת התמונות אינו זמין כרגע. נסה שוב בעוד כמה דקות." : "Photo storage is currently unavailable. Try again in a few minutes.");
        return;
      }
      if (!response.ok || !result.photo) throw new Error(result.error || `upload-${response.status}`);
      setPhotos((current) => [result.photo!, ...current]);
      setUploadFile(null);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      setUploadVin("");
      setUploadOpen(false);
      stopCamera();
    } catch {
      setPhotoError(he
        ? "לא ניתן היה להשלים את השמירה. בדוק את החיבור ונסה שוב."
        : "Saving could not be completed. Check the connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const managerReturnTo = `/?adminPart=${encodeURIComponent(part.partNumber)}`;
  const managerSignInHref = `/signin-with-chatgpt?return_to=${encodeURIComponent(managerReturnTo)}`;

  const openPhotoEditor = (photo: RealPartPhoto) => {
    if (!canManagePhotos) return;
    setEditingPhoto(photo);
    setEditSource(photo.source);
    setEditVin(photo.vin);
    setEditStatus(photo.status);
    setEditReplacementFile(null);
    setEditError("");
    if (editReplacementInputRef.current) editReplacementInputRef.current.value = "";
  };

  const selectReplacementPhoto = async (file: File | null) => {
    setEditReplacementFile(null);
    setEditError("");
    if (!file) return;

    setEditPreparing(true);
    try {
      setEditReplacementFile(await preparePhotoFile(file, part.partNumber));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "type") {
        setEditError(he ? "יש לבחור קובץ תמונה." : "Choose an image file.");
      } else if (reason === "original-size") {
        setEditError(he ? "התמונה המקורית גדולה מדי. ניתן לבחור תמונה עד 20MB." : "The original image is too large. Choose an image up to 20 MB.");
      } else {
        setEditError(he ? "לא ניתן להכין את התמונה להחלפה." : "The replacement image could not be prepared.");
      }
    } finally {
      setEditPreparing(false);
    }
  };

  const savePhotoChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingPhoto) return;

    setEditSaving(true);
    setEditError("");
    try {
      let response: Response;
      if (editReplacementFile) {
        const form = new FormData();
        form.append("key", editingPhoto.key);
        form.append("partNumber", part.partNumber);
        form.append("file", editReplacementFile);
        form.append("source", editSource);
        form.append("vin", editVin);
        form.append("status", editStatus);
        response = await fetch("/api/photos", { method: "PUT", body: form });
      } else {
        response = await fetch("/api/photos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: editingPhoto.key,
            partNumber: part.partNumber,
            source: editSource,
            vin: editVin,
            status: editStatus,
          }),
        });
      }

      const result = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as { photo?: RealPartPhoto; error?: string }
        : { error: await response.text() };
      if (response.status === 401) {
        setCanManagePhotos(false);
        setPhotoViewerSignedIn(false);
        setEditError(he ? "פג תוקף החיבור. יש להיכנס שוב כמנהל." : "Your session expired. Sign in again as manager.");
        return;
      }
      if (response.status === 403) {
        setCanManagePhotos(false);
        setEditError(he ? "לחשבון המחובר אין הרשאה לערוך תמונות." : "The signed-in account cannot edit photos.");
        return;
      }
      if (!response.ok || !result.photo) {
        throw new Error(result.error || `update-${response.status}`);
      }

      const updatedPhoto = result.photo;
      setPhotos((current) => current.map((photo) => photo.key === updatedPhoto.key ? updatedPhoto : photo));
      setOpenPhoto((current) => current?.key === updatedPhoto.key ? updatedPhoto : current);
      setEditingPhoto(null);
      setEditReplacementFile(null);
    } catch {
      setEditError(he ? "לא ניתן לשמור את השינויים. בדוק את החיבור ונסה שוב." : "The changes could not be saved. Check the connection and try again.");
    } finally {
      setEditSaving(false);
    }
  };

  const deletePhoto = async (photo: RealPartPhoto) => {
    if (!canManagePhotos) return;
    const confirmed = window.confirm(he
      ? "למחוק את התמונה לצמיתות? לא ניתן לבטל את הפעולה."
      : "Delete this photo permanently? This cannot be undone.");
    if (!confirmed) return;

    setEditSaving(true);
    setEditError("");
    setPhotoError("");
    try {
      const params = new URLSearchParams({ key: photo.key, partNumber: part.partNumber });
      const response = await fetch(`/api/photos?${params.toString()}`, { method: "DELETE" });
      if (response.status === 401) {
        setCanManagePhotos(false);
        setPhotoViewerSignedIn(false);
        const message = he ? "פג תוקף החיבור. יש להיכנס שוב כמנהל." : "Your session expired. Sign in again as manager.";
        setEditError(message);
        setPhotoError(message);
        return;
      }
      if (response.status === 403) {
        setCanManagePhotos(false);
        const message = he ? "לחשבון המחובר אין הרשאה למחוק תמונות." : "The signed-in account cannot delete photos.";
        setEditError(message);
        setPhotoError(message);
        return;
      }
      if (!response.ok) throw new Error(`delete-${response.status}`);

      setPhotos((current) => current.filter((item) => item.key !== photo.key));
      setOpenPhoto(null);
      setEditingPhoto(null);
    } catch {
      const message = he ? "לא ניתן למחוק את התמונה. בדוק את החיבור ונסה שוב." : "The photo could not be deleted. Check the connection and try again.";
      setEditError(message);
      setPhotoError(message);
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <>
      {availableOccurrences.length > 1 && <div className="matchSelector">
        <span>{preferredCatalog ? (he ? "מופעים נוספים בתוך הקטלוג הנוכחי" : "Other matches inside this catalog") : (he ? "בחר התאמה בקטלוג" : "Select a catalog match")}</span>
        <div className="occTabs">
          {availableOccurrences.map((item, index) => (
            <button key={`${item.catalog}-${index}`} className={index === activeOccurrence ? "active" : ""} onClick={() => chooseOccurrence(index)}>
              <b>{item.model} {item.year}</b><span>{item.assemblyCode || item.assembly || `${he ? "התאמה" : "Match"} ${index + 1}`}</span>
            </button>
          ))}
        </div>
      </div>}

      <nav className="catalogBreadcrumb" aria-label={he ? "מיקום החלק בקטלוג" : "Part location in catalog"}>
        <span className="breadcrumbMarker" aria-hidden="true">●</span>
        <button type="button" onClick={() => active && onBrowseLocation(part, active, "catalogs")}>{he ? "כל הקטלוגים" : "All catalogs"}</button>
        <b aria-hidden="true">/</b>
        <button type="button" onClick={() => active && onBrowseLocation(part, active, "catalog")}>{active?.model || part.models[0] || (he ? "דגם לא צוין" : "Model not specified")}</button>
        <b aria-hidden="true">/</b>
        <button type="button" className="current" onClick={() => active && onBrowseLocation(part, active, "assembly")}>{active?.assembly || (he ? "מכלול לא צוין" : "Assembly not specified")}</button>
      </nav>

      <section className="assemblyWorkbenchV2" aria-labelledby="part-product-title">
        <header className="assemblyWorkbenchHead">
          <div>
            <span>{he ? "שרטוט מכלול" : "Assembly diagram"}</span>
            <strong>{activeGroup?.title || active?.assembly || (he ? "מכלול" : "Assembly")}</strong>
            <small className="assemblyCatalogName"><b>{he ? "קטלוג" : "Catalog"}</b><code dir="ltr">{active?.catalog || preferredCatalog || "—"}</code></small>
          </div>
          <div className="assemblyContext">
            <span><b>{he ? "דגם" : "Model"}</b>{active?.model || part.models[0] || "—"}</span>
            <span><b>{he ? "קוד מכלול" : "Assembly code"}</b><code dir="ltr">{active?.assemblyCode || activeGroup?.code || "—"}</code></span>
          </div>
          <div className="assemblyWorkbenchActions">
            <div className="workbenchViewSwitch" role="group" aria-label={he ? "תצוגת מכלול" : "Assembly view"}>
              <button type="button" aria-pressed={workbenchView === "split"} onClick={() => setWorkbenchView("split")}><Columns2 size={16} aria-hidden="true" />{he ? "מפוצל" : "Split"}</button>
              <button type="button" aria-pressed={workbenchView === "diagram"} onClick={() => setWorkbenchView("diagram")}><ImageIcon size={16} aria-hidden="true" />{he ? "שרטוט" : "Diagram"}</button>
              <button type="button" aria-pressed={workbenchView === "list"} onClick={() => setWorkbenchView("list")}><ListTree size={16} aria-hidden="true" />{he ? "רשימה" : "List"}</button>
            </div>
            {activeGroup?.figure && <button type="button" className="fullscreenButton" onClick={() => setFigureOpen(true)}>
              <span aria-hidden="true">⛶</span>{he ? "מסך מלא" : "Full screen"}
            </button>}
          </div>
        </header>

        <div className={`assemblyWorkbenchMain workbenchView-${workbenchView}`}>
          <div className="assemblyDiagramPane">
            <div className="assemblyDiagramTools">
              <span className="sourceTruth"><ShieldCheck size={14} aria-hidden="true" />{he ? "שרטוט היצרן" : "Manufacturer diagram"}</span>
              <div className="assemblyDiagramToolActions">
                {active?.position && <div className="positionCallout"><span>{he ? "מיקום החלק" : "Part position"}</span><b>{active.position}</b></div>}
                <div className="diagramZoomControls" role="group" aria-label={he ? "שינוי גודל השרטוט" : "Diagram zoom"}>
                  <button type="button" onClick={() => setDiagramZoom((value) => Math.max(70, value - 10))} aria-label={he ? "הקטנת שרטוט" : "Zoom out"}><Minus size={15} /></button>
                  <output>{diagramZoom}%</output>
                  <button type="button" onClick={() => setDiagramZoom((value) => Math.min(170, value + 10))} aria-label={he ? "הגדלת שרטוט" : "Zoom in"}><Plus size={15} /></button>
                  <button type="button" onClick={() => setDiagramZoom(100)} aria-label={he ? "איפוס גודל" : "Reset zoom"}><RotateCcw size={14} /></button>
                </div>
              </div>
            </div>
            <button
              type="button"
              className={`assemblyDiagramStage${activeGroup?.figure ? " clickable" : ""}`}
              onClick={() => activeGroup?.figure ? setFigureOpen(true) : undefined}
              disabled={!activeGroup?.figure}
              aria-label={he ? "פתיחת השרטוט במסך מלא" : "Open diagram full screen"}
            >
              {activeGroup?.figure ? <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activeGroup.figure} alt={`${he ? "שרטוט עבור" : "Diagram for"} ${activeGroup.title || part.partNumber}`} style={{ width: `${diagramZoom}%` }} />
              </> : <div className="noFigure"><b>{he ? "שרטוט לא זמין למכלול זה" : "Diagram unavailable for this assembly"}</b><span>{he ? "המידע על המק״ט נשמר, אך לא נמצא שרטוט שניתן לקשר אליו בוודאות." : "Part information is available, but no diagram could be linked with confidence."}</span></div>}
            </button>
          </div>

          <aside className="assemblyTablePane">
            <div className="assemblyTableTitle">
              <div><span>{he ? "רשימת חלקים" : "Parts list"}</span><strong>{visibleAssemblyParts.length} / {assemblyParts.length} {he ? "חלקים במכלול" : "assembly parts"}</strong></div>
              <label className="assemblyTableSearch">
                <span className="srOnly">{he ? "חיפוש ברשימת החלקים" : "Search parts list"}</span>
                <ScanSearch size={15} aria-hidden="true" />
                <input value={assemblySearch} onChange={(event) => setAssemblySearch(event.target.value)} placeholder={he ? "מק״ט, תיאור או מיקום..." : "Part no., description or position..."} />
              </label>
            </div>
            <div className="assemblyPartsHead" aria-hidden="true">
              <span>{he ? "מס׳" : "No."}</span>
              <span>{he ? "מק״ט" : "Part No."}</span>
              <span>{he ? "תיאור" : "Description"}</span>
            </div>
            <div className="assemblyPartsBody">
              {visibleAssemblyParts.map((item) => (
                <div className="assemblyPartRowWithCopy" key={`${item.partNumber}-${item.position}`}>
                  <button
                    type="button"
                    className={item.selected ? "assemblyPartRow selected" : "assemblyPartRow"}
                    disabled={item.selected}
                    onClick={() => onSearch(item.partNumber)}
                    aria-current={item.selected ? "true" : undefined}
                  >
                    <mark>{item.position || "—"}</mark>
                    <b dir="ltr">{item.partNumber}</b>
                    <span className="assemblyPartDescription"><strong>{item.description}</strong>{(item.quantity || item.notes) && <small>{[
                      item.quantity ? `${he ? "כמות" : "Qty"}: ${[item.quantity, item.unit].filter(Boolean).join(" ")}` : "",
                      item.notes,
                    ].filter(Boolean).join(" · ")}</small>}</span>
                  </button>
                  <CopyPartNumberButton partNumber={item.partNumber} he={he} compact />
                </div>
              ))}
              {!visibleAssemblyParts.length && <div className="assemblyPartsEmpty">{he ? "לא נמצאו חלקים במכלול לפי החיפוש הזה." : "No assembly parts match this search."}</div>}
            </div>
          </aside>
        </div>

        <div className="selectedPartDock">
          <div className="selectedPartPosition"><span>{he ? "מיקום" : "Position"}</span><strong>{active?.position || "—"}</strong></div>
          <div className="selectedPartIdentity">
            <span>{he ? "החלק הנבחר" : "Selected part"}</span>
            <div className="selectedPartNumberLine"><h1 id="part-product-title" dir="ltr">{part.partNumber}</h1><CopyPartNumberButton partNumber={part.partNumber} he={he} /></div>
          </div>
          <div className="selectedPartDescription">
            <h2>{displayPartDescription(part, he, he ? "ללא תיאור" : "No description")}</h2>
            {he && part.descriptionHebrew && part.description && <p><span>{he ? "תיאור היצרן" : "Manufacturer description"}</span>{part.description}</p>}
          </div>
          <div className="selectedPartMeta">
            <span><BusFront size={15} aria-hidden="true" /><b>{he ? "דגם" : "Model"}</b>{scopedModels.join(", ") || part.models.join(", ") || "—"}</span>
            <span><Layers3 size={15} aria-hidden="true" /><b>{he ? "כמות" : "Quantity"}</b>{[active?.quantity, active?.unit].filter(Boolean).join(" ") || "—"}</span>
          </div>
          <div className="selectedPartActions">
            <button type="button" onClick={() => openDetailTab("photos")}><Camera size={16} aria-hidden="true" />{he ? `תמונות (${photosLoading ? "…" : photos.length})` : `Photos (${photosLoading ? "…" : photos.length})`}</button>
            <button type="button" onClick={() => openDetailTab("fitment")}><BusFront size={16} aria-hidden="true" />{he ? "בדיקת התאמה" : "Check fitment"}</button>
            <button type="button" onClick={() => void sharePart()}><Share2 size={16} aria-hidden="true" />{he ? "שיתוף" : "Share"}</button>
            <button type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />{he ? "הדפסה" : "Print"}</button>
            <span className="srOnly" role="status" aria-live="polite">{shareFeedback}</span>
          </div>
        </div>
      </section>

      <div className="workbenchSupportRow">
        <section className="catalogEvidenceCard">
          <ShieldCheck size={22} aria-hidden="true" />
          <div><span>{he ? "מקור המידע" : "Information source"}</span><strong>{he ? "קטלוג היצרן הוא מקור האמת" : "The manufacturer catalog is the source of truth"}</strong><small>{he ? "המק״ט והמיקום מוצגים לפי המכלול שנבחר למעלה." : "The part number and position follow the selected assembly above."}</small></div>
        </section>
        <section className="catalogAiDock" aria-label={he ? "עוזר הקטלוג" : "Catalog assistant"}>
          <div className="catalogAiAvatar">AI</div>
          <div><span>{he ? "עוזר הקטלוג" : "Catalog assistant"}</span><strong>{he ? "מה תרצה לבדוק על החלק?" : "What would you like to check?"}</strong></div>
          <button type="button" onClick={() => openDetailTab("fitment")}>{he ? "תאימות לדגמים ושלדות" : "Models & VINs"}</button>
          <button type="button" onClick={() => openDetailTab("related")}>{he ? "חלקים קשורים" : "Related parts"}</button>
        </section>
      </div>

      <div className="partDetailTabs" ref={detailTabsRef} role="tablist" aria-label={he ? "מידע נוסף על המק״ט" : "More part information"}>
        <button type="button" role="tab" aria-selected={activeDetailTab === "photos"} className={activeDetailTab === "photos" ? "active" : ""} onClick={() => setActiveDetailTab("photos")}>
          <Images size={17} aria-hidden="true" />{he ? `תמונות (${photos.length})` : `Photos (${photos.length})`}
        </button>
        <button type="button" role="tab" aria-selected={activeDetailTab === "fitment"} className={activeDetailTab === "fitment" ? "active" : ""} onClick={() => setActiveDetailTab("fitment")}>
          <BusFront size={17} aria-hidden="true" />{he ? "התאמה לדגמים ושלדות" : "Models & VINs"}
        </button>
        <button type="button" role="tab" aria-selected={activeDetailTab === "related"} className={activeDetailTab === "related" ? "active" : ""} onClick={() => setActiveDetailTab("related")}>
          <ListTree size={17} aria-hidden="true" />{he ? `חלקים קשורים (${related.length})` : `Related (${related.length})`}
        </button>
        <button type="button" role="tab" aria-selected={activeDetailTab === "notes"} className={activeDetailTab === "notes" ? "active" : ""} onClick={() => setActiveDetailTab("notes")}>
          <FileText size={17} aria-hidden="true" />{he ? "פרטים והערות" : "Details & notes"}
        </button>
      </div>

      {activeDetailTab === "photos" && <section className="realPhotos partTabPanel" role="tabpanel">
        <div className="realPhotosHead">
          <div>
            <span>{he ? "תיעוד מהשטח" : "Field documentation"}</span>
            <h3>{he ? `תמונות אמיתיות (${photos.length})` : `Real photos (${photos.length})`}</h3>
            <p>{he ? "תמונות שצולמו או התקבלו בפועל ומשויכות למק״ט הזה." : "Photos captured or received in practice and linked to this part number."}</p>
          </div>
          <div className="realPhotosActions">
            {canManagePhotos ? <span className="photoManagerBadge">
              <ShieldCheck size={15} aria-hidden="true" />
              {he ? "מצב מנהל" : "Manager mode"}
            </span> : <a className="managePhotosButton" href={managerSignInHref}>
              <LogIn size={15} aria-hidden="true" />
              {photoViewerSignedIn
                ? (he ? "החשבון המחובר אינו מורשה" : "This account is not authorized")
                : (he ? "כניסת מנהל לעריכה ומחיקה" : "Manager sign-in for edit and delete")}
            </a>}
            <button type="button" className="addPhotoButton" onClick={() => {
              if (uploadOpen) stopCamera();
              setUploadOpen((value) => !value);
              setPhotoError("");
            }}>
              {uploadOpen ? <X size={17} aria-hidden="true" /> : <Camera size={17} aria-hidden="true" />}
              {uploadOpen ? (he ? "סגירה" : "Close") : (he ? "הוספת תמונה אמיתית" : "Add a real photo")}
            </button>
          </div>
        </div>

        {uploadOpen && <form className="photoUploadForm" onSubmit={uploadPhoto}>
          <div className="photoInputGroup">
            <span className="photoInputLabel">{he ? "צירוף תמונה" : "Attach a photo"}</span>
            <div className="photoInputActions">
              <button className="photoSourcePicker cameraPicker" type="button" onClick={startCamera} disabled={cameraStarting}>
                <Camera size={20} aria-hidden="true" />
                <span>
                  <strong>{cameraStarting ? (he ? "פותח מצלמה..." : "Opening camera...") : (he ? "פתח מצלמה" : "Open camera")}</strong>
                  <small>{he ? "צילום ישיר מהאתר" : "Take a photo directly in the site"}</small>
                </span>
              </button>
              <input
                className="cameraFallbackInput"
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void selectPhotoFile(event.target.files?.[0] ?? null)}
              />
              <label className="photoSourcePicker galleryPicker">
                <Upload size={20} aria-hidden="true" />
                <span>
                  <strong>{he ? "בחר מהגלריה" : "Choose from gallery"}</strong>
                  <small>{he ? "תמונה קיימת בטלפון או במחשב" : "An existing photo on this device"}</small>
                </span>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void selectPhotoFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div className={uploadFile ? "selectedPhotoFile ready" : "selectedPhotoFile"}>
              {preparingPhoto
                ? (he ? "מכין את התמונה לשמירה..." : "Preparing the image...")
                : uploadFile
                ? (he ? `נבחרה תמונה: ${uploadFile.name}` : `Selected: ${uploadFile.name}`)
                : (he ? "לאחר הצילום או הבחירה, לחץ על שמירה למק״ט." : "After taking or choosing a photo, save it to the part number.")}
            </div>
          </div>
          {cameraOpen && <div className="cameraLivePanel">
            <div className="cameraLiveHead">
              <strong>{he ? "המצלמה פעילה" : "Camera is active"}</strong>
              <button type="button" onClick={stopCamera} aria-label={he ? "סגירת המצלמה" : "Close camera"}><X size={18} /></button>
            </div>
            <video ref={cameraVideoRef} autoPlay muted playsInline aria-label={he ? "תצוגה חיה מהמצלמה" : "Live camera view"} />
            <div className="cameraLiveActions">
              <button type="button" className="capturePhotoButton" onClick={capturePhoto}>
                <Camera size={18} aria-hidden="true" />
                {he ? "צלם תמונה" : "Take photo"}
              </button>
              <button type="button" className="cancelCameraButton" onClick={stopCamera}>{he ? "ביטול" : "Cancel"}</button>
            </div>
          </div>}
          <label>
            <span>{he ? "מקור התמונה" : "Photo source"}</span>
            <select value={uploadSource} onChange={(event) => setUploadSource(event.target.value as RealPartPhoto["source"])}>
              <option value="warehouse">{he ? "צולם במחסן" : "Warehouse photo"}</option>
              <option value="manufacturer">{he ? "התקבל מהיצרן" : "From manufacturer"}</option>
              <option value="workshop">{he ? "מהמוסך או מהלקוח" : "Workshop or customer"}</option>
              <option value="other">{he ? "מקור אחר" : "Other source"}</option>
            </select>
          </label>
          <label>
            <span>{he ? "מספר שלדה (לא חובה)" : "VIN (optional)"}</span>
            <input
              value={uploadVin}
              onChange={(event) => setUploadVin(normalizeVin(event.target.value))}
              maxLength={17}
              placeholder={he ? "אם התמונה שייכת לשלדה מסוימת" : "If the photo belongs to a specific VIN"}
              dir="ltr"
            />
          </label>
          <div className="newPhotoStatusNote">
            <Clock3 size={15} aria-hidden="true" />
            <span>{he ? "תמונה חדשה נשמרת כממתינה לאימות מנהל." : "New photos are saved as pending manager verification."}</span>
          </div>
          <button className="savePhotoButton" type="submit" disabled={uploading || preparingPhoto}>
            {uploading ? (he ? "שומר תמונה..." : "Saving photo...") : (he ? `שמירה למק״ט ${part.partNumber}` : `Save to ${part.partNumber}`)}
          </button>
        </form>}

        {photoError && <div className="photoError" role="alert">{photoError}</div>}
        {photosLoading ? <div className="photoEmpty">{he ? "טוען תמונות..." : "Loading photos..."}</div> : photos.length ? (
          <div className="photoGallery">
            {photos.map((photo) => (
              <button type="button" className="photoCard" key={photo.key} onClick={() => setOpenPhoto(photo)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`${he ? "תמונה אמיתית של מק״ט" : "Real photo of part"} ${part.partNumber}`} loading="lazy" decoding="async" />
                <span className={`photoStatus ${photo.status}`}>
                  {photo.status === "verified" ? <CheckCircle2 size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}
                  {photo.status === "verified" ? (he ? "תמונה מאומתת" : "Verified photo") : (he ? "ממתין לאימות" : "Pending verification")}
                </span>
                <span className="photoMeta">
                  <strong>{sourceLabel(photo.source)}</strong>
                  {photo.vin && <small dir="ltr">{photo.vin}</small>}
                </span>
              </button>
            ))}
          </div>
        ) : <div className="photoEmpty">
          <Camera size={26} aria-hidden="true" />
          <strong>{he ? "עדיין אין תמונות אמיתיות למק״ט הזה" : "No real photos for this part yet"}</strong>
          <span>{he ? "אפשר להעלות תמונה מהמחשב או מהטלפון ולשייך אותה ישירות." : "Upload a photo from a computer or phone and link it directly."}</span>
        </div>}
      </section>}

      {activeDetailTab === "fitment" && <section className="partTabPanel fitmentTabPanel" role="tabpanel">
        <div className="fitmentSummary">
          <div>
            <span className="panelEyebrow">{he ? "התאמה לפי הקטלוגים הקיימים" : "Fitment from available catalogs"}</span>
            <h3>{he ? `${scopedModels.length || 1} דגמים · ${allVins.length} שלדות` : `${scopedModels.length || 1} models · ${allVins.length} VINs`}</h3>
            <p>{he ? "ההתאמה מוצגת לפי קטלוג היצרן. לפני הזמנה מומלץ לוודא מול השלדה הרלוונטית." : "Fitment is based on the manufacturer catalog. Verify against the relevant VIN before ordering."}</p>
          </div>
          <div className="fitmentModels">
            {scopedModels.length ? scopedModels.map((model) => <span key={model}><BusFront size={15} aria-hidden="true" />{model}</span>) : <span>{he ? "דגם לא צוין" : "Model not specified"}</span>}
          </div>
        </div>

        <div className="vinPreview">
          <div className="sectionTitle"><h3>{he ? `שלדות מתאימות (${allVins.length})` : `Matching chassis (${allVins.length})`}</h3></div>
          {allVins.length ? <>
            <div className="vinChips">{(showAllVins ? allVins : allVins.slice(0, 12)).map((vin) => <code key={vin}>{vin}</code>)}</div>
            {allVins.length > 12 && <button type="button" className="textButton" onClick={() => setShowAllVins((value) => !value)}>{showAllVins ? (he ? "הצג פחות" : "Show less") : (he ? `הצג את כל ${allVins.length} השלדות` : `Show all ${allVins.length} chassis`)}</button>}
          </> : <div className="softEmpty">{he ? "לא הופיעו מספרי שלדה בקטלוג זה." : "No chassis numbers appear in this catalog."}</div>}
        </div>

        <div className="occurrenceList">
          {availableOccurrences.map((item, index) => (
            <article key={`${item.catalog}-${index}`}>
              <div className="occHead">
                <div><b>{item.model}</b><span>{[item.year, item.engine, item.vehicleType].filter(Boolean).join(" · ")}</span></div>
                {item.quantity && <mark>{item.quantity} {item.unit}</mark>}
              </div>
              <dl>
                <div><dt>{he ? "שלדות בקטלוג" : "Chassis in catalog"}</dt><dd>{catalogVins.get(item.catalog)?.length || item.vinCount || (he ? "לא צוינו" : "Not specified")}</dd></div>
                <div><dt>{he ? "קבוצת פריט" : "Assembly"}</dt><dd>{item.assembly || (he ? "לא צוינה" : "Not specified")}</dd></div>
                <div><dt>{he ? "קוד קבוצה" : "Assembly code"}</dt><dd dir="ltr">{item.assemblyCode || (he ? "לא צוין" : "Not specified")}</dd></div>
                <div><dt>{he ? "מיקום בשרטוט" : "Diagram position"}</dt><dd>{item.position || (he ? "לא צוין" : "Not specified")}</dd></div>
                {item.notes && <div className="wide"><dt>{he ? "הערה" : "Note"}</dt><dd>{item.notes}</dd></div>}
              </dl>
              <div className="catalogName" title={item.catalog}>{he ? "מקור" : "Source"}: {item.catalog}</div>
            </article>
          ))}
        </div>
      </section>}

      {activeDetailTab === "related" && <section className="partTabPanel relatedTabPanel" role="tabpanel">
        <div className="tabPanelHeading">
          <div><span className="panelEyebrow">{he ? "מאותו שרטוט או מכלול" : "From the same diagram or assembly"}</span><h3>{he ? "חלקים קשורים" : "Related parts"}</h3></div>
          <span>{related.length} {he ? "חלקים" : "parts"}</span>
        </div>
        {related.length ? <div className="relatedList">{related.map((item) => (
          <div className="relatedPartWithCopy" key={item.partNumber}>
            <button onClick={() => onSearch(item.partNumber)}>
              <span className="relatedPartText">
                <b dir="ltr">{item.partNumber}</b>
                <span>{item.description}</span>
              </span>
              <span
                className={`relatedPosition${item.position ? "" : " unavailable"}`}
                aria-label={item.position
                  ? `${he ? "מספר בשרטוט" : "Diagram number"} ${item.position}`
                  : (he ? "לא צוין מספר בשרטוט" : "No diagram number specified")}
                title={item.position
                  ? `${he ? "מספר בשרטוט" : "Diagram number"} ${item.position}`
                  : (he ? "לא צוין מספר בשרטוט" : "No diagram number specified")}
              >
                {item.position ? <><small>{he ? "מס׳" : "No."}</small><strong>{item.position}</strong></> : "—"}
              </span>
            </button>
            <CopyPartNumberButton partNumber={item.partNumber} he={he} compact />
          </div>
        ))}</div> : <div className="softEmpty">{he ? "לא נמצאו חלקים נוספים במכלול." : "No other parts were found in this assembly."}</div>}
      </section>}

      {activeDetailTab === "notes" && <section className="partTabPanel notesTabPanel" role="tabpanel">
        <div className="tabPanelHeading">
          <div><span className="panelEyebrow">{he ? "מידע נוסף מהקטלוג" : "Additional catalog information"}</span><h3>{he ? "פרטים והערות" : "Details and notes"}</h3></div>
          <Wrench size={21} aria-hidden="true" />
        </div>
        <div className="figureMeta">
          <Info label={he ? "מיקום בשרטוט" : "Diagram position"} value={active?.position || (he ? "לא צוין" : "Not specified")} />
          <Info label={he ? "קוד מכלול" : "Assembly code"} value={active?.assemblyCode || (he ? "לא צוין" : "Not specified")} />
          <Info label={he ? "שנות ייצור" : "Production years"} value={scopedYears.join(", ") || part.years.join(", ") || (he ? "לא צוין" : "Not specified")} />
          <Info label={he ? "מספר קטלוגים" : "Catalog count"} value={String(new Set(availableOccurrences.map((item) => item.catalog)).size)} />
          <Info label={he ? "מקור בקטלוג" : "Catalog source"} value={active?.catalog || (he ? "לא צוין" : "Not specified")} />
          <Info label={he ? "תיאור בסינית" : "Chinese description"} value={part.descriptionChinese || (he ? "לא צוין" : "Not specified")} />
          <div className="partNotesBox">
            <span>{he ? "הערת קטלוג" : "Catalog note"}</span>
            <strong>{active?.notes || (he ? "אין הערות למק״ט זה." : "No notes for this part number.")}</strong>
          </div>
        </div>
      </section>}

      {figureOpen && activeGroup?.figure && <div className="figureModal" role="dialog" aria-modal="true" aria-label={he ? "שרטוט במסך מלא" : "Full screen diagram"}>
        <div className="modalToolbar">
          {active?.position && <div className="positionCallout"><span>{he ? "מיקום בשרטוט" : "Diagram position"}</span><b>{active.position}</b></div>}
          <button onClick={() => setFigureOpen(false)} aria-label={he ? "סגירה" : "Close"}>×</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeGroup.figure} alt={`${he ? "שרטוט עבור" : "Diagram for"} ${activeGroup.title || part.partNumber}`} />
      </div>}
      {openPhoto && <div className="photoModal" role="dialog" aria-modal="true" aria-label={he ? "תמונה אמיתית במסך מלא" : "Real photo full screen"}>
        <div className="modalToolbar">
          <div className={`photoStatus ${openPhoto.status}`}>
            {openPhoto.status === "verified" ? <CheckCircle2 size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
            {openPhoto.status === "verified" ? (he ? "תמונה מאומתת" : "Verified photo") : (he ? "ממתין לאימות" : "Pending verification")}
          </div>
          <div className="photoModalButtons">
            {canManagePhotos && <>
              <button type="button" className="photoModalEdit" onClick={() => openPhotoEditor(openPhoto)}>
                <Pencil size={16} aria-hidden="true" />
                {he ? "עריכה" : "Edit"}
              </button>
              <button type="button" className="photoModalDelete" onClick={() => void deletePhoto(openPhoto)} disabled={editSaving}>
                <Trash2 size={16} aria-hidden="true" />
                {he ? "מחיקה" : "Delete"}
              </button>
            </>}
            <button type="button" className="photoModalClose" onClick={() => setOpenPhoto(null)} aria-label={he ? "סגירה" : "Close"}>×</button>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={openPhoto.url} alt={`${he ? "תמונה אמיתית של מק״ט" : "Real photo of part"} ${part.partNumber}`} />
      </div>}
      {editingPhoto && <div className="photoEditBackdrop" role="dialog" aria-modal="true" aria-label={he ? "עריכת תמונה" : "Edit photo"}>
        <form className="photoEditCard" onSubmit={savePhotoChanges}>
          <div className="photoEditHead">
            <div>
              <span>{he ? "ניהול תמונה" : "Photo management"}</span>
              <h3>{he ? `עריכת תמונה למק״ט ${part.partNumber}` : `Edit photo for ${part.partNumber}`}</h3>
            </div>
            <button type="button" onClick={() => setEditingPhoto(null)} aria-label={he ? "סגירה" : "Close"}><X size={19} /></button>
          </div>

          <div className="photoEditBody">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="photoEditPreview" src={editingPhoto.url} alt={he ? "התמונה הנוכחית" : "Current photo"} />
            <div className="photoEditFields">
              <label>
                <span>{he ? "מקור התמונה" : "Photo source"}</span>
                <select value={editSource} onChange={(event) => setEditSource(event.target.value as RealPartPhoto["source"])}>
                  <option value="warehouse">{he ? "צולם במחסן" : "Warehouse photo"}</option>
                  <option value="manufacturer">{he ? "התקבל מהיצרן" : "From manufacturer"}</option>
                  <option value="workshop">{he ? "מהמוסך או מהלקוח" : "Workshop or customer"}</option>
                  <option value="other">{he ? "מקור אחר" : "Other source"}</option>
                </select>
              </label>
              <label>
                <span>{he ? "מספר שלדה (לא חובה)" : "VIN (optional)"}</span>
                <input value={editVin} onChange={(event) => setEditVin(normalizeVin(event.target.value))} maxLength={17} dir="ltr" />
              </label>
              <label>
                <span>{he ? "מצב האימות" : "Verification status"}</span>
                <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as RealPartPhoto["status"])}>
                  <option value="pending">{he ? "ממתין לאימות" : "Pending verification"}</option>
                  <option value="verified">{he ? "מאומת – המק״ט נבדק" : "Verified – part number checked"}</option>
                </select>
              </label>
              <label className="replacePhotoPicker">
                <Upload size={18} aria-hidden="true" />
                <span>
                  <strong>{he ? "החלפת התמונה" : "Replace photo"}</strong>
                  <small>{editPreparing
                    ? (he ? "מכין את התמונה..." : "Preparing image...")
                    : editReplacementFile
                    ? (he ? `נבחרה: ${editReplacementFile.name}` : `Selected: ${editReplacementFile.name}`)
                    : (he ? "לא חובה – הפרטים יישמרו גם בלי החלפה" : "Optional – details can be saved without replacement")}</small>
                </span>
                <input
                  ref={editReplacementInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void selectReplacementPhoto(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>

          {editError && <div className="photoError" role="alert">{editError}</div>}
          <div className="photoEditActions">
            <button type="button" className="photoEditDelete" onClick={() => void deletePhoto(editingPhoto)} disabled={editSaving}>
              <Trash2 size={16} aria-hidden="true" />
              {he ? "מחיקת התמונה" : "Delete photo"}
            </button>
            <div>
              <button type="button" className="photoEditCancel" onClick={() => setEditingPhoto(null)}>{he ? "ביטול" : "Cancel"}</button>
              <button type="submit" className="photoEditSave" disabled={editSaving || editPreparing}>
                {editSaving ? (he ? "שומר..." : "Saving...") : (he ? "שמירת שינויים" : "Save changes")}
              </button>
            </div>
          </div>
        </form>
      </div>}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="info"><span>{label}</span><strong>{value}</strong></div>;
}
