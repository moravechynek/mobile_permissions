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

// Two groups: what an app gets silently (the interesting part) and what needs the user's consent.
const groups = {
  free: { el: document.getElementById('free'), cards: [] },
  asks: { el: document.getElementById('asks'), cards: [] },
};

// `actions` entries may be falsy to leave a button out on one platform.
function card({ title, note, actions, group = 'asks' }) {
  const el = document.createElement('section');
  el.className = 'card';
  el.innerHTML = `<h3>${title}</h3>${note ? `<p class="note">${note}</p>` : ''}<div class="actions"></div><pre class="out"></pre>`;
  const out = el.querySelector('.out');
  const log = (msg, kind = 'ok') => {
    out.className = `out ${kind}`;
    out.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  };
  for (const [label, fn] of actions.filter(Boolean)) {
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
  groups[group].cards.push(el);
}

// Masonry: cards go into fixed columns (each to the currently shortest one), so cards of different
// heights leave no gaps. Columns are rebuilt only when their count changes, so cards don't jump around
// while their output grows.
const CARD_MIN_WIDTH = 340;
const GAP = 12;
let columnCount = 0;

function layoutCards() {
  const n = Math.max(1, Math.floor((groups.free.el.clientWidth + GAP) / (CARD_MIN_WIDTH + GAP)));
  if (n === columnCount) return;
  columnCount = n;
  for (const { el, cards } of Object.values(groups)) {
    const cols = Array.from({ length: n }, () => Object.assign(document.createElement('div'), { className: 'col' }));
    el.replaceChildren(...cols);
    for (const c of cards) cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a)).append(c);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
const notOnWeb = (what) => new Error(`${what} – na webu/PWA to nejde, jen v nativní aplikaci`);

// ---------- Environment ----------

document.getElementById('env').innerHTML = [
  `<span class="tag ${isNative ? 'native' : 'web'}">${isNative ? `nativní (${platform})` : 'web'}</span>`,
  !isNative ? `<span class="tag">${isStandalone ? 'nainstalovaná PWA' : 'v prohlížeči'}</span>` : '',
  `<span class="tag">${window.isSecureContext ? 'secure context' : 'NENÍ secure context (HTTPS!)'}</span>`,
].join(' ');

// ---------- Demos ----------

// Everything the Permissions API knows about; unsupported names throw and are reported as such.
const WEB_PERMISSIONS = [
  'geolocation', 'camera', 'microphone', 'notifications', 'push', 'clipboard-read', 'clipboard-write',
  'persistent-storage', 'accelerometer', 'gyroscope', 'magnetometer', 'ambient-light-sensor', 'background-sync',
  'screen-wake-lock', 'midi', 'storage-access', 'window-management', 'local-fonts', 'idle-detection', 'nfc',
];

const LEVELS = {
  runtime: 'runtime – dialog',
  special: 'speciální – Nastavení',
  normal: 'normální – bez ptaní',
  signature: 'signature',
  internal: 'interní',
  unknown: 'na této verzi neexistuje',
};

function formatAndroidPermissions({ permissions, sdkInt }) {
  const order = Object.keys(LEVELS);
  const sorted = [...permissions].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  let level;
  const lines = [`Android API ${sdkInt}, oprávnění v manifestu: ${permissions.length}`];
  for (const p of sorted) {
    if (p.level !== level) lines.push('', `${LEVELS[p.level] ?? p.level}:`);
    level = p.level;
    lines.push(`  ${p.granted ? '✓' : '✗'} ${p.name.replace('android.permission.', '')}`);
  }
  return lines.join('\n');
}

card({
  title: 'Všechna oprávnění',
  note:
    'Web: Permissions API – co stránka smí, aniž by se ptala. Android: vše z AndroidManifest.xml ' +
    's úrovní ochrany (normální / runtime / speciální). „Požádat o všechna“ ukazuje, proč aplikace nemají žádat vše najednou.',
  actions: [
    [
      'Vypsat',
      async (log) => {
        if (isNative) return log(formatAndroidPermissions(await DeviceInsights.getAllPermissions()));
        const result = {};
        for (const name of WEB_PERMISSIONS) {
          try {
            const desc = name === 'push' ? { name, userVisibleOnly: true } : { name };
            result[name] = (await navigator.permissions.query(desc)).state;
          } catch {
            result[name] = 'nepodporováno';
          }
        }
        log(result);
      },
    ],
    isNative && [
      'Požádat o všechna',
      async (log) => log(formatAndroidPermissions(await DeviceInsights.requestAllPermissions())),
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

let mic = null; // { stream, ctx, raf }

card({
  title: 'Mikrofon',
  note:
    'Android: RECORD_AUDIO (runtime), od 12 indikátor a vypínač v rychlém nastavení. Web: getUserMedia jen přes HTTPS. ' +
    'Před povolením prohlížeč skrývá názvy zařízení – jinak by šly použít k fingerprintingu.',
  actions: [
    [
      'Zapnout',
      async (log, el) => {
        if (mic) return log('Mikrofon už běží.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        let meter = el.querySelector('.meter');
        if (!meter) {
          meter = Object.assign(document.createElement('div'), { className: 'meter', innerHTML: '<div></div>' });
          el.append(meter);
        }
        const bar = meter.firstElementChild;
        const samples = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
          bar.style.width = `${Math.min(100, rms * 400)}%`;
          mic.raf = requestAnimationFrame(tick);
        };
        mic = { stream, ctx };
        tick();
        log(`Mikrofon běží: ${stream.getAudioTracks()[0].label || '(bez názvu)'} – zkuste mluvit.`);
      },
    ],
    [
      'Vypnout',
      async (log, el) => {
        if (mic) {
          cancelAnimationFrame(mic.raf);
          mic.stream.getTracks().forEach((t) => t.stop());
          await mic.ctx.close();
          mic = null;
        }
        el.querySelector('.meter')?.remove();
        log('Mikrofon vypnut.');
      },
    ],
    [
      'Seznam zařízení',
      async (log) => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        log(devices.map((d) => `${d.kind}: ${d.label || '(název skrytý – zatím bez povolení)'}`).join('\n') || 'Žádná zařízení.');
      },
    ],
  ],
});

const GENERIC_SENSORS = [
  'Accelerometer', 'LinearAccelerationSensor', 'GravitySensor', 'Gyroscope', 'Magnetometer',
  'AbsoluteOrientationSensor', 'RelativeOrientationSensor', 'AmbientLightSensor',
];

card({
  group: 'free',
  title: 'Senzory pohybu',
  note:
    'Akcelerometr a gyroskop nechtějí na Androidu žádné oprávnění (od 12 jen omezená frekvence 200 Hz). ' +
    'iOS 13+ se na pohyb ptá. Krokoměr: ACTIVITY_RECOGNITION (Android 10+), tep: BODY_SENSORS.',
  actions: [
    [
      'Měřit 5 s',
      async (log) => {
        // iOS 13+ only: must be called from a click.
        if (typeof DeviceMotionEvent?.requestPermission === 'function') {
          const state = await DeviceMotionEvent.requestPermission();
          if (state !== 'granted') return log(`iOS oprávnění: ${state}`, 'err');
        }
        let count = 0;
        let accel = {};
        let orient = {};
        const onMotion = (e) => {
          count++;
          const a = e.accelerationIncludingGravity ?? {};
          accel = { x: round(a.x), y: round(a.y), z: round(a.z) };
        };
        const onOrient = (e) => (orient = { alpha: round(e.alpha), beta: round(e.beta), gamma: round(e.gamma) });
        addEventListener('devicemotion', onMotion);
        addEventListener('deviceorientation', onOrient);
        const start = performance.now();
        const timer = setInterval(() => log({ zrychleni_m_s2: accel, orientace_st: orient }, 'pending'), 200);
        await sleep(5000);
        clearInterval(timer);
        removeEventListener('devicemotion', onMotion);
        removeEventListener('deviceorientation', onOrient);
        if (!count) return log('Žádná data – zařízení nemá pohybové senzory (desktop?) nebo je přístup blokovaný.', 'err');
        log({ zrychleni_m_s2: accel, orientace_st: orient, frekvence_hz: Math.round(count / ((performance.now() - start) / 1000)) });
      },
    ],
    [
      'Seznam senzorů',
      async (log) => {
        if (isNative) {
          const { sensors } = await DeviceInsights.getSensors();
          return log(`Senzorů: ${sensors.length} (bez jakéhokoli oprávnění)\n\n` + sensors.map((s) => `${s.type}  —  ${s.name}`).join('\n'));
        }
        log({
          DeviceMotionEvent: 'DeviceMotionEvent' in window,
          DeviceOrientationEvent: 'DeviceOrientationEvent' in window,
          ...Object.fromEntries(GENERIC_SENSORS.map((n) => [n, n in window])),
        });
      },
    ],
    [
      'Kroky',
      async (log) => {
        if (!isNative) throw notOnWeb('Krokoměr');
        log(await DeviceInsights.readSteps());
      },
    ],
  ],
});

card({
  group: 'free',
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
  title: 'Kontakty a kalendář',
  note:
    'Android: READ_CONTACTS / READ_CALENDAR dají přístup ke všem záznamům najednou (jména jsou tu zamaskovaná). ' +
    'Web: Contact Picker (jen Chrome na Androidu) – uživatel vybere konkrétní kontakty, nic víc.',
  actions: [
    [
      'Vybrat kontakt',
      async (log) => {
        if (!('contacts' in navigator)) throw new Error('Contact Picker API tu není (jen Chrome na Androidu)');
        const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
        log(picked.length ? picked : 'Nic nevybráno.');
      },
    ],
    [
      'Všechny kontakty',
      async (log) => {
        if (!isNative) throw notOnWeb('Číst celý adresář');
        const r = await DeviceInsights.readContacts();
        log(`Kontaktů: ${r.count}\n\nPrvní: ${r.sample.join(', ')}`);
      },
    ],
    [
      'Kalendář',
      async (log) => {
        if (!isNative) throw notOnWeb('Číst kalendář');
        const r = await DeviceInsights.readCalendar();
        log(`Událostí: ${r.events}\nÚčty: ${r.accounts.join(', ') || '–'}`);
      },
    ],
  ],
});

card({
  title: 'Zařízení v okolí',
  note:
    'Android 12+: Bluetooth má vlastní oprávnění „Zařízení v okolí“ (dřív bylo potřeba polohu). ' +
    'Název Wi‑Fi (SSID) ale pořád vyžaduje polohu – podle sítě se dá zjistit, kde jste. Web: jen výběr jednoho Bluetooth zařízení.',
  actions: [
    [
      isNative ? 'Spárovaná Bluetooth zařízení' : 'Vybrat Bluetooth zařízení',
      async (log) => {
        if (isNative) return log(await DeviceInsights.getBluetoothDevices());
        if (!navigator.bluetooth) throw new Error('Web Bluetooth tu není (Chrome/Edge, ne Safari ani Firefox)');
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
        log({ nazev: device.name, id: device.id });
      },
    ],
    [
      'Název Wi‑Fi',
      async (log) => {
        if (isNative) return log(await DeviceInsights.getWifiInfo());
        const c = navigator.connection;
        log({
          ssid: 'web nezjistí',
          ...(c ? { typ: c.type, rychlost: c.effectiveType, downlink_mbps: c.downlink, rtt_ms: c.rtt } : { connection: 'Network Information API chybí' }),
        });
      },
    ],
    isNative && ['Wi‑Fi s polohou', async (log) => log(await DeviceInsights.getWifiInfo({ requestLocation: true }))],
  ],
});

card({
  group: 'free',
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

// Collects ICE candidates: "host" = local address (browsers hide it behind a random *.local name),
// "srflx" = public address as seen by the STUN server.
async function webrtcCandidates() {
  if (!window.RTCPeerConnection) throw new Error('WebRTC tu není k dispozici');
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const found = new Map();
  pc.onicecandidate = ({ candidate }) => {
    // "candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ..."
    const parts = candidate?.candidate.split(' ');
    if (parts?.length > 7 && parts[4]) found.set(parts[4], parts[7]);
  };
  pc.createDataChannel('');
  await pc.setLocalDescription(await pc.createOffer());
  await Promise.race([
    new Promise((r) => (pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r())),
    sleep(4000),
  ]);
  pc.close();
  return [...found].map(([address, type]) => `${type === 'host' ? 'lokální' : type === 'srflx' ? 'veřejná (STUN)' : type}: ${address}`);
}

// Free keyless services with CORS; the second one is a fallback for when the first hits its daily limit.
async function ipLocation(ip) {
  const fromApi = async (url, map) => {
    const res = await fetch(url, { cache: 'no-store' });
    const d = await res.json();
    if (!res.ok || d.error || d.bogon) throw new Error(d.reason ?? d.error?.message ?? `HTTP ${res.status}`);
    return map(d);
  };
  const format = ({ city, region, country, lat, lon, org, source }) => ({
    poloha: [city, region, country].filter(Boolean).join(', '),
    souradnice: lat != null ? `${lat}, ${lon}` : '?',
    mapa: lat != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}` : undefined,
    poskytovatel: org,
    zdroj: source,
  });
  try {
    return format(
      await fromApi(`https://ipinfo.io/${ip}/json`, (d) => {
        const [lat, lon] = d.loc?.split(',') ?? [];
        return { city: d.city, region: d.region, country: d.country, lat, lon, org: d.org, source: 'ipinfo.io' };
      }),
    );
  } catch {
    return format(
      await fromApi(`https://ipapi.co/${ip}/json/`, (d) => ({
        city: d.city, region: d.region, country: d.country_name, lat: d.latitude, lon: d.longitude,
        org: [d.asn, d.org].filter(Boolean).join(' '), source: 'ipapi.co',
      })),
    );
  }
}

async function browserInfo() {
  const uad = navigator.userAgentData;
  const info = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    webview: /; wv\)/.test(navigator.userAgent) ? 'ano (Android WebView)' : 'ne',
  };
  if (!uad) return { ...info, userAgentData: 'nepodporováno (Safari, Firefox)' };
  // Low-entropy hints are free; high-entropy ones are also granted silently in Chrome, just must be asked for.
  const high = await uad.getHighEntropyValues(['platformVersion', 'model', 'architecture', 'bitness', 'fullVersionList']);
  return {
    ...info,
    prohlizec: uad.brands.filter((b) => !/Not.?A.?Brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).join(', '),
    os: `${uad.platform} ${high.platformVersion ?? ''}`.trim(),
    model: high.model || '(neuvedeno)',
    architektura: `${high.architecture ?? '?'} ${high.bitness ?? ''}bit`,
    mobil: uad.mobile,
    plne_verze: high.fullVersionList?.map((b) => `${b.brand} ${b.version}`).join(', '),
  };
}

card({
  group: 'free',
  title: 'IP, MAC, systém a prohlížeč',
  note:
    'Nic z toho nevyžaduje oprávnění. Veřejnou IP vidí každý server, se kterým appka mluví, a podle ní odhadne polohu ' +
    '(země spolehlivě, město jen přibližně, na mobilních datech nebo přes VPN často úplně mimo). ' +
    'Lokální IP: web ji přes WebRTC skryje za náhodné *.local, nativní appka ji zjistí. ' +
    'MAC adresu nedostane nikdo: web nemá API, Android 6+ vrací 02:00:00:00:00:00 a 11+ nic – náhradou je ANDROID_ID.',
  actions: [
    [
      'Veřejná IP',
      async (log) => {
        // Any server sees this; the page itself only learns it by asking one.
        const res = await fetch('https://api64.ipify.org?format=json', { cache: 'no-store' });
        const { ip } = await res.json();
        const result = { verejna_ip: ip, verze: ip.includes(':') ? 'IPv6' : 'IPv4' };
        log(result, 'pending');
        // Geolocation databases only guess: country is reliable, city often off, mobile data usually wrong.
        try {
          log({ ...result, ...(await ipLocation(ip)) });
        } catch (e) {
          log({ ...result, poloha: `nezjištěno (${e.message})` });
        }
      },
    ],
    [
      'Lokální IP a MAC',
      async (log) => {
        if (isNative) {
          const r = await DeviceInsights.getDeviceIdentity();
          return log({
            rozhrani: r.interfaces.map((i) => `${i.name}: ${i.ips.join(', ')}  (MAC: ${i.mac ?? 'skrytá'})`),
            wifi_mac: `${r.wifiMac} ${r.wifiMac === '02:00:00:00:00:00' ? '(falešná – Android 6+)' : ''}`.trim(),
            android_id: r.androidId,
          });
        }
        log({ webrtc: await webrtcCandidates(), mac: 'web nezjistí – žádné API' });
      },
    ],
    [
      'Systém a prohlížeč',
      async (log) => {
        const web = await browserInfo();
        if (!isNative) return log(web);
        const r = await DeviceInsights.getDeviceIdentity();
        log({
          zarizeni: `${r.manufacturer} ${r.model}`,
          android: `${r.androidVersion} (API ${r.sdkInt}), bezpečnostní záplata ${r.securityPatch}`,
          webview: web,
        });
      },
    ],
  ],
});

let wakeLock = null;

card({
  group: 'free',
  title: 'Bez ptaní',
  note:
    'Co aplikace dostane bez jakéhokoli dialogu (na Androidu „normální“ oprávnění jako VIBRATE nebo ACCESS_NETWORK_STATE). ' +
    'Takové údaje se kombinují k fingerprintingu zařízení.',
  actions: [
    [
      'Vibrovat',
      async (log) => {
        if (!navigator.vibrate) throw new Error('Vibration API tu není (iOS, desktop)');
        log(navigator.vibrate([200, 100, 200]) ? 'Bzzz.' : 'Prohlížeč vibraci odmítl (chce kliknutí uživatele).');
      },
    ],
    [
      'Nezhasínat displej',
      async (log) => {
        if (wakeLock) {
          await wakeLock.release();
          wakeLock = null;
          return log('Displej zase smí zhasnout.');
        }
        if (!navigator.wakeLock) throw new Error('Screen Wake Lock API tu není');
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.onrelease = () => (wakeLock = null);
        log('Displej nezhasne, dokud je stránka vidět. Klikněte znovu pro vypnutí.');
      },
    ],
    [
      'Co o mně ví',
      async (log) => {
        const battery = await navigator.getBattery?.();
        const c = navigator.connection;
        log({
          baterie: battery ? `${Math.round(battery.level * 100)} %${battery.charging ? ', nabíjí se' : ''}` : 'nedostupné',
          sit: c ? `${c.effectiveType}, ${c.downlink} Mb/s` : 'nedostupné',
          jader_cpu: navigator.hardwareConcurrency,
          pamet_gb: navigator.deviceMemory ?? 'nedostupné',
          displej: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
          jazyky: navigator.languages.join(', '),
          casova_zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
          dotyk: navigator.maxTouchPoints,
        });
      },
    ],
  ],
});

layoutCards();
new ResizeObserver(layoutCards).observe(groups.free.el);

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
