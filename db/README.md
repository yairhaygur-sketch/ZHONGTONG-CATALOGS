# שכבת הקטלוג ב-D1

הקטלוג נשמר היום כקובץ סטטי אחד, `public/parts-data.json`, בגודל 17MB.
כל מבקר מוריד את הקטלוג המלא של כל דגמי האוטובוסים כדי לחפש חלק אחד,
והגודל גדל לינארית עם כל קטלוג שנוסף. הקבצים כאן מעבירים את הנתונים
ל-D1 ואת החיפוש לצד השרת.

## מדידה

| | קובץ סטטי | D1 |
|---|---|---|
| מה שהדפדפן מוריד לחיפוש | 17,271,238 בייטים | 1,236 בייטים |
| זמן חיפוש | 30–49ms (אחרי הורדה מלאה) | 24–30ms |
| טעינה ראשונית | ~7 שניות | ללא |

הנתונים: 16 קטלוגים, 2,050 מכלולים, 13,228 מק״טים, 27,556 הופעות, 371 שלדות.

## הפעלה

1. `.openai/hosting.json` — לקבוע `"d1": "DB"` כדי שהפלטפורמה תזריק את הבינדינג.
2. `npm run db:generate` — מייצר את המיגרציה מ-`db/schema.ts` לתוך `drizzle/`.
3. להחיל את המיגרציה, ואז לטעון את הנתונים:

```bash
node scripts/seed_d1.mjs > /tmp/seed.sql
npx wrangler d1 execute DB --local --persist-to .wrangler/state \
  --file drizzle/0000_sticky_bullseye.sql
npx wrangler d1 execute DB --local --persist-to .wrangler/state --file /tmp/seed.sql
```

`seed_d1.mjs` קורא את `public/parts-data.json` ואת `public/hebrew-descriptions.json`
ופולט SQL. הוא מוחק את הטבלאות וטוען מחדש, כך שאפשר להריץ אותו אחרי כל ייבוא.

## הנתיבים

| נתיב | מה מחזיר |
|---|---|
| `GET /api/search?q=&limit=` | תוצאות מדורגות. מק״ט מותאם על הצורה חסרת המפרידים, כך ש-`37478600012`, `3747 86 00012` ו-`3747-86-00012` מגיעים לאותו חלק. |
| `GET /api/part/:partNumber` | חלק אחד עם כל ההופעות, המכלולים והשרטוטים. מקבל גם צורה חסרת מפרידים. |
| `GET /api/summary` | ספירות ורשימת הקטלוגים — מה שדף הבית צריך כדי להיצבע בלי הקטלוג המלא. |

## מה עוד נדרש כדי להוריד את ה-17MB

הנתיבים קיימים ונבדקו, אבל `app/page.tsx` עדיין טוען את הקובץ המלא. **לא חיברתי
את הלקוח בכוונה:** כל עוד ה-blob נטען ממילא, מעבר של ההצעות ל-API היה הרעה —
30ms מקומי מול 30ms ועוד רשת. הרווח מגיע רק כשהקובץ מפסיק להיטען לגמרי.

מה שצריך לעבור ל-API לפני שאפשר למחוק את הטעינה:

- `partIndex`, `loosePartIndex`, `suggestIndex`, `rankedResults` → `/api/search`
- `models`, `featuredCatalogs`, `vinCount`, מסך הפתיחה → `/api/summary`
- `CatalogBrowser` (מכלולים וחלקים לפי קטלוג) → נתיב חדש `/api/catalog/:catalog`
- `VinSearchResult` → נתיב חדש `/api/vin/:vin`
- כרטיס החלק → `/api/part/:partNumber`

`db/index.ts` קורא את הבינדינג מתוך `globalThis.__ZT_SITE_ENV__` ולא מ-`cloudflare:workers`;
לייבוא הסטטי של המודול הזה אין מימוש ב-Node והוא מפיל את שלב ה-prerender של `vinext build`.

## סדר ההרצה אחרי ייבוא קטלוג

```bash
python3 scripts/import_catalog_update.py --source-dir ./catalogs --dry-run   # מה עומד להשתנות
python3 scripts/import_catalog_update.py --source-dir ./catalogs             # ייבוא
node scripts/translate_descriptions.mjs                                      # תיאורים בעברית לחלקים החדשים
node scripts/seed_d1.mjs > /tmp/seed.sql && npx wrangler d1 execute DB --file /tmp/seed.sql
```

התרגום לפני הזריעה, כדי שהתיאורים בעברית ייכנסו ל-`haystack` שעליו רץ החיפוש.
