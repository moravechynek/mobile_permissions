Ukázková aplikace k prezentaci o oprávněních mobilních aplikací: stejný kód jako PWA i nativní Android aplikace.

## Novinky ve verzi 1.1.1

- Aplikace je rozdělená na dvě části: **Funguje bez ptaní** (schránka, nainstalované aplikace, fingerprinting, senzory) a **Ptá se uživatele** (poloha, kamera, kontakty…).

## Novinky ve verzi 1.1

- Karta **IP, MAC, systém a prohlížeč**: veřejná IP s odhadem polohy, lokální IP (WebRTC vs. nativně), MAC adresa (skrytá), `ANDROID_ID`, User-Agent a Client Hints.
- Karty mikrofon, senzory pohybu, kontakty a kalendář, zařízení v okolí, všechna oprávnění.

## Stažení

- **Android:** `permission-explorer.apk` níže (debug build, instalace mimo Google Play – povolte „Instalovat neznámé aplikace“).
- **Web / PWA (Android, iOS, desktop):** https://moravechynek.github.io/mobile_permissions/

## Kompatibilita

| Platforma | Podpora |
|---|---|
| **Android 7.0+** (API 24) | ✅ APK – minimální verze |
| Android 16 (API 36) | ✅ cílová verze (targetSdk), plně otestované chování |
| iOS / iPadOS | ❌ APK nelze nainstalovat → použijte PWA v Safari (Sdílet → Přidat na plochu; notifikace iOS 16.4+) |
| Desktop (Chrome, Edge, Firefox, Safari) | jen PWA |

Architektura: univerzální (arm64, armv7, x86, x86_64) – aplikace nemá nativní knihovny.

### Co se liší podle verze Androidu

| Funkce | Od verze |
|---|---|
| Runtime oprávnění (poloha, kamera) | 6.0 – vždy |
| Zákaz čtení schránky na pozadí | 10 |
| Package visibility (omezený seznam aplikací), „All files access“ | 11 |
| Toast při čtení schránky, přibližná poloha, indikátor kamery | 12 |
| `READ_MEDIA_IMAGES` místo `READ_EXTERNAL_STORAGE` | 13 |
| Přístup jen k vybraným fotkám | 14 |

Na starších verzích se příslušné ukázky chovají „postaru“ (např. Android 9 povolí čtení schránky i na pozadí).

> Pozn.: APK je podepsané debug klíčem z CI. Pokud máte nainstalovanou verzi sestavenou jinde, nejdřív ji odinstalujte.
