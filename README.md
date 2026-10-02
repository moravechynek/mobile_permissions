# Permission Explorer

Demo aplikace k prezentaci o mobilních aplikacích: **stejný kód** běží jako **PWA** i jako **nativní Android aplikace** (Capacitor), takže jde přímo porovnat, co která varianta smí.

| Karta | PWA / web | Nativní Android |
|---|---|---|
| Všechna oprávnění | Permissions API (20 názvů) | celý manifest + úroveň ochrany, „Požádat o všechna“ |
| Schránka | `navigator.clipboard` (gesto + svolení) | `ClipboardManager` přes vlastní plugin, test čtení z pozadí |
| Nainstalované aplikace | ❌ nejde | ✅ `PackageManager` (omezeno package visibility) |
| Poloha, kamera, mikrofon | prompt prohlížeče | runtime permission Androidu (`RECORD_AUDIO` aj.) |
| Senzory pohybu | DeviceMotion/Orientation (iOS 13+ se ptá) | seznam senzorů bez oprávnění, krokoměr `ACTIVITY_RECOGNITION` |
| Kontakty, kalendář | Contact Picker (vybrané kontakty) | `READ_CONTACTS`, `READ_CALENDAR` – vše najednou |
| Zařízení v okolí | Web Bluetooth (výběr zařízení) | `BLUETOOTH_CONNECT` (12+), SSID Wi‑Fi jen s polohou |
| IP, MAC, systém | veřejná IP (ipify), lokální IP skrytá za `*.local` (WebRTC), User-Agent / Client Hints, MAC nikdy | lokální IP všech rozhraní, MAC skrytá (6+: `02:00…`, 11+: nic), `ANDROID_ID`, model a verze |
| Bez ptaní | vibrace, wake lock, baterie, síť | normální oprávnění (`VIBRATE`, `ACCESS_NETWORK_STATE`) |
| Úložiště | kvóta + `navigator.storage.persist()`, soubory jen přes picker | `READ_MEDIA_*` (13+), „jen vybrané fotky“ (14+), `MANAGE_EXTERNAL_STORAGE` |
| Notifikace | Notification API (iOS jen nainstalovaná PWA) | ❌ ve WebView není (nutný nativní plugin) |

## Struktura

```
index.html, src/          webová aplikace (vanilla JS + Vite)
public/manifest.webmanifest, public/sw.js   PWA (instalovatelnost, offline)
android/                  Capacitor Android projekt
  app/src/main/AndroidManifest.xml          oprávnění + <queries>
  app/src/main/java/cz/explore/permissions/DeviceInsightsPlugin.java   nativní plugin
```

## Spuštění

```bash
npm install
npm run dev          # vývoj, http://<ip>:5173 (pozor: clipboard/kamera/poloha chtějí HTTPS nebo localhost)
npm run build        # produkční build do dist/ = PWA
```

### PWA (distribuce bez storu)
Nahrajte `dist/` na libovolný HTTPS hosting (GitHub Pages, Netlify, Cloudflare Pages).
- Android/Chrome: objeví se tlačítko „Nainstalovat jako PWA“, případně menu → Přidat na plochu.
- iOS/Safari: Sdílet → Přidat na plochu.

### Android APK (sideload / alternativní story)
Potřebuje JDK 21 a Android SDK (nejsnáz Android Studio). Bez lokálního buildu: hotové APK
sestaví GitHub Actions (workflow „Build Android APK“ → Artifacts).

```bash
npm run android:open   # otevře projekt v Android Studiu
npm run android:apk    # nebo z CLI → android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

APK lze rozdat přímo, přes GitHub Releases (+ Obtainium) nebo F-Droid.

## Scénáře pro prezentaci

1. **Clipboard z pozadí:** „Zapsat text“ → „Přečíst za 5 s“ → přepnout do jiné aplikace.
   Na Androidu 10+ vrátí `text: null`, protože aplikace není v popředí. Při čtení v popředí ukáže Android 12+ toast.
2. **Seznam aplikací:** „Vypsat“ ukáže jen systémové aplikace + WhatsApp a prohlížeče (z `<queries>`).
   Pak v `AndroidManifest.xml` odkomentujte `QUERY_ALL_PACKAGES`, přebuildujte a uvidíte **všechno**.
   Proto ho Google Play povoluje jen schváleným kategoriím aplikací.
3. **Web vs. nativ:** stejná karta „Nainstalované aplikace“ v PWA skončí chybou „not implemented“.
4. **Úložiště:** „Požádat o fotky“ → na Androidu 14+ zvolit „Vybrat fotky“ a vybrat 2 → `visibleImages: 2`.
   Pak v Nastavení povolit vše a znovu „Zjistit“. „Vybrat soubor“ funguje i bez oprávnění (systémový picker).
   Pro `MANAGE_EXTERNAL_STORAGE` ho odkomentujte v manifestu a zapněte v Nastavení → Zvláštní přístup aplikací.
5. **Oprávnění:** poloha („jen tentokrát“, přibližná poloha), kamera (indikátor v liště), pak
   odebrání oprávnění v Nastavení → Aplikace a znovu „Stav oprávnění“.
