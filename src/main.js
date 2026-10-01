import { Capacitor, registerPlugin } from '@capacitor/core';
import './style.css';

// Custom native plugin, implemented in android/app/src/main/java/cz/explore/permissions/DeviceInsightsPlugin.java.
// On the web it has no implementation, so every call rejects with "not implemented".
const DeviceInsights = registerPlugin('DeviceInsights');

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// ---------- UI helpers ----------

const cards = document.getElementById('cards');

function card({ title, note, actions }) {
  const el = document.createElement('section');
  el.className = 'card';
  el.innerHTML = `<h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ''}<div class="actions"></div><pre class="out"></pre>`;
  const out = el.querySelector('.out');
  const log = (msg, kind = 'ok') => {
    out.className = `out ${kind}`;
    out.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  };
  for (const [label, fn] of actions) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = async () => {
      log('…', 'pending');
      try {
        await fn(log, el);
      } catch (e) {
        log(`${e.name ?? 'Error'}: ${e.message ?? e}`, 'err');
      }
    };
    el.querySelector('.actions').append(btn);
  }
  cards.append(el);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Environment ----------

document.getElementById('env').innerHTML = [
  `<span class="tag ${isNative ? 'native' : 'web'}">${isNative ? `nativní (${platform})` : 'web'}</span>`,
  !isNative ? `<span class="tag">${isStandalone ? 'nainstalovaná PWA' : 'v prohlížeči'}</span>` : '',
  `<span class="tag">${window.isSecureContext ? 'secure context' : 'NENÍ secure context (HTTPS!)'}</span>`,
].join(' ');

// ---------- Demos ----------

card({
  title: 'Stav oprávnění',
  note: 'Permissions API: co aplikace smí, aniž by se uživatele ptala.',
  actions: [
    [
      'Zjistit',
      async (log) => {
        const names = ['geolocation', 'camera', 'microphone', 'notifications', 'clipboard-read', 'clipboard-write', 'persistent-storage'];
        const result = {};
        for (const name of names) {
          try {
            result[name] = (await navigator.permissions.query({ name })).state;
          } catch {
            result[name] = 'nepodporováno';
          }
        }
        log(result);
      },
    ],
  ],
});

card({
  title: 'Schránka (clipboard)',
  note:
    'Zápis je většinou volný. Čtení: web jen po gestu + svolení; Android 10+ blokuje čtení na pozadí, ' +
    'Android 12+ ukáže toast „… vložila ze schránky“, iOS 16+ se ptá.',
  actions: [
    [
      'Zapsat text',
      async (log) => {
        const text = `Tajné heslo ${Math.random().toString(36).slice(2, 8)}`;
        await navigator.clipboard.writeText(text);
        log(`Zapsáno: ${text}`);
      },
    ],
    [
      'Přečíst',
      async (log) => {
        const text = isNative ? (await DeviceInsights.readClipboard()).text : await navigator.clipboard.readText();
        log(text == null ? '(nic / přístup odepřen)' : `Přečteno: ${text}`);
      },
    ],
    [
      'Přečíst za 5 s (přepni appku!)',
      async (log) => {
        log('Za 5 s čtu schránku – přepni teď do jiné aplikace…', 'pending');
        if (isNative) {
          // Delay is done natively, because WebView timers may be paused in the background.
          const r = await DeviceInsights.readClipboardDelayed({ delayMs: 5000 });
          log(r);
        } else {
          await sleep(5000);
          log(`Přečteno: ${await navigator.clipboard.readText()}`);
        }
      },
    ],
  ],
});

card({
  title: 'Nainstalované aplikace',
  note:
    'Jen nativně. Android 11+ (package visibility): bez QUERY_ALL_PACKAGES vidíš jen systémové appky ' +
    'a ty z &lt;queries&gt; v manifestu. Web/PWA tohle nezjistí vůbec.',
  actions: [
    [
      'Vypsat',
      async (log) => {
        const r = await DeviceInsights.getInstalledApps();
        const userApps = r.apps.filter((a) => !a.system);
        log(
          `QUERY_ALL_PACKAGES v manifestu: ${r.queryAllPackages ? 'ANO' : 'ne'}\n` +
            `Viditelných balíčků: ${r.apps.length} (z toho uživatelských: ${userApps.length})\n\n` +
            userApps.map((a) => `${a.label}  —  ${a.packageName}`).join('\n'),
        );
      },
    ],
    [
      'Je nainstalován WhatsApp?',
      async (log) => {
        const r = await DeviceInsights.isInstalled({ packageName: 'com.whatsapp' });
        log(r);
      },
    ],
  ],
});

const PHOTOS = { full: 'všechny fotky', partial: 'jen vybrané fotky (Android 14+)', denied: 'žádné' };

const formatBytes = (n) => (n == null ? '?' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);

card({
  title: 'Úložiště',
  note:
    'Web: jen vlastní sandbox (kvóta, „persistent storage“) a soubory, které uživatel sám vybere. ' +
    'Android 13+: místo READ_EXTERNAL_STORAGE jen média (READ_MEDIA_*), Android 14+ i „jen vybrané fotky“. ' +
    'Přístup ke všem souborům (MANAGE_EXTERNAL_STORAGE) se zapíná ručně v Nastavení.',
  actions: [
    [
      'Zjistit',
      async (log) => {
        if (isNative) {
          const r = await DeviceInsights.getStorageStatus();
          return log({ ...r, photos: PHOTOS[r.photos] });
        }
        if (!navigator.storage) throw new Error('StorageManager API tu není k dispozici');
        const { usage, quota } = await navigator.storage.estimate();
        log({
          vyuzito: formatBytes(usage),
          kvota: formatBytes(quota),
          persistentni: await navigator.storage.persisted(),
        });
      },
    ],
    [
      isNative ? 'Požádat o fotky' : 'Požádat o trvalé úložiště',
      async (log) => {
        if (isNative) {
          const r = await DeviceInsights.requestMediaAccess();
          return log({ ...r, photos: PHOTOS[r.photos] });
        }
        // Chrome decides silently (engagement, installed PWA, bookmarks), Firefox asks the user.
        const granted = await navigator.storage.persist();
        log(granted ? 'Trvalé úložiště povoleno – prohlížeč data nesmaže při nedostatku místa.' : 'Zamítnuto.', granted ? 'ok' : 'err');
      },
    ],
    [
      'Vybrat soubor',
      (log) =>
        new Promise((resolve) => {
          // The system picker works without any permission: the user grants access to exactly the chosen files.
          const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
          input.onchange = () =>
            resolve(log([...input.files].map((f) => `${f.name}  —  ${formatBytes(f.size)}, ${f.type || '?'}`).join('\n')));
          input.oncancel = () => resolve(log('Zrušeno.', 'err'));
          input.click();
        }),
    ],
  ],
});

card({
  title: 'Poloha',
  note: 'Uživatel může dát jen přibližnou polohu nebo povolení „jen tentokrát“.',
  actions: [
    [
      'Získat polohu',
      (log) =>
        new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve(log({ lat: coords.latitude, lon: coords.longitude, presnost_m: coords.accuracy })),
            reject,
            { enableHighAccuracy: true, timeout: 15000 },
          ),
        ),
    ],
  ],
});

card({
  title: 'Kamera',
  note: 'Při použití svítí indikátor kamery (Android 12+, iOS 14+).',
  actions: [
    [
      'Zapnout',
      async (log, el) => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        let video = el.querySelector('video');
        if (!video) {
          video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
          el.append(video);
        }
        video.srcObject = stream;
        log('Kamera běží.');
      },
    ],
    [
      'Vypnout',
      async (log, el) => {
        const video = el.querySelector('video');
        video?.srcObject?.getTracks().forEach((t) => t.stop());
        video?.remove();
        log('Kamera vypnuta.');
      },
    ],
  ],
});

card({
  title: 'Notifikace',
  note: 'iOS: web push jen pro PWA přidanou na plochu (iOS 16.4+). Android WebView Notification API nemá.',
  actions: [
    [
      'Povolit a poslat',
      async (log) => {
        if (!('Notification' in window)) throw new Error('Notification API tu není k dispozici');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return log(`Oprávnění: ${perm}`, 'err');
        const reg = await navigator.serviceWorker?.getRegistration();
        const opts = { body: 'Ahoj z Permission Exploreru', icon: './icons/icon-192.png' };
        reg ? await reg.showNotification('Permission Explorer', opts) : new Notification('Permission Explorer', opts);
        log('Odesláno.');
      },
    ],
  ],
});

// ---------- PWA: service worker + install prompt ----------

if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js');
}

const installBtn = document.getElementById('install');
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.onclick = async () => {
  deferredPrompt?.prompt();
  await deferredPrompt?.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
};
