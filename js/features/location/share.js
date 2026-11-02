// The phone's "Chia sẻ vị trí của tôi" switch (Android app only). The native LocationShare plugin runs a foreground
// service that posts a point about every 2 minutes and reports sharing on/off itself; this only asks for permissions,
// warns first, points to the battery settings that Xiaomi/Poco and Samsung need, and starts or stops it.
const WARNED = 'homie.location.warned';

const plugin = () => {
  const capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.LocationShare ?? capacitor.registerPlugin?.('LocationShare') ?? null;
};

/** Settings steps for phones that stop background apps on their own. */
export function batteryTips(manufacturer = '') {
  const brand = manufacturer.toLowerCase();
  if (/xiaomi|redmi|poco/.test(brand)) return 'Máy Xiaomi/Poco hay tự tắt app chạy ngầm: vào Cài đặt › Ứng dụng › Homie, bật “Tự khởi chạy” và chọn Tiết kiệm pin = “Không giới hạn”.';
  if (/samsung/.test(brand)) return 'Máy Samsung hay cho app “ngủ”: vào Cài đặt › Ứng dụng › Homie › Pin, chọn “Không hạn chế”, và bỏ Homie khỏi “Ứng dụng ngủ” / “Ứng dụng ngủ sâu”.';
  return 'Nếu vị trí hay bị dừng: vào Cài đặt › Ứng dụng › Homie › Pin và chọn không hạn chế.';
}

const warned = () => { try { return localStorage.getItem(WARNED) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(WARNED, '1'); } catch {} };

/** { root, cleanup }; onChange() after sharing starts or stops so the page can refresh. */
export function mountSharing({ signal, onChange }) {
  const share = plugin();
  const root = document.createElement('section');
  root.className = 'location-share';
  if (!share) {
    root.innerHTML = '<p class="location-hint">Chia sẻ vị trí chỉ bật được trong app Android. Ở đây bạn xem được vị trí và timeline của cả hai.</p>';
    return { root, cleanup: () => root.remove() };
  }
  const title = document.createElement('h2');
  title.textContent = 'Chia sẻ vị trí của tôi';
  const line = document.createElement('p');
  line.className = 'location-hint';
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const extra = document.createElement('div');
  root.append(title, line, actions, extra);
  let state = null, busy = false;

  const button = (text, className, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.addEventListener('click', onClick, { signal });
    return b;
  };
  const say = text => { line.textContent = text; };

  function show() {
    if (signal.aborted) return;
    actions.replaceChildren(state?.running
      ? button('Dừng chia sẻ', 'secondary-button', stop)
      : button('Bật chia sẻ', 'primary-button', ask));
    actions.firstChild.disabled = busy;
    say(state?.running ? 'Đang chia sẻ, khoảng 2 phút một lần. Tự tắt khi pin dưới 20%.' : 'Đang tắt.');
  }

  async function load() {
    try { state = await share.status(); } catch { state = null; }
    show();
  }

  function ask() {
    if (warned()) return start();
    const box = document.createElement('div');
    box.className = 'location-warning';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-labelledby', 'location-warning-text');
    const text = document.createElement('p');
    text.id = 'location-warning-text';
    text.textContent = 'Chia sẻ vị trí chạy ngầm cả khi bạn đóng app, nên tốn pin hơn, và Android sẽ luôn hiện thông báo “Homie đang chia sẻ vị trí”. Tự tắt khi pin dưới 20%. Người kia thấy vị trí, note và các địa điểm bạn ghé.';
    const row = document.createElement('div');
    row.className = 'form-actions';
    const later = button('Để sau', 'secondary-button', () => { extra.replaceChildren(); actions.firstChild?.focus(); });
    row.append(button('Đồng ý, bật', 'primary-button', () => { remember(); extra.replaceChildren(); start(); }), later);
    box.append(text, row);
    extra.replaceChildren(box);
    later.focus();
  }

  async function start() {
    busy = true; show();
    try {
      const permission = await share.requestPermissions();
      if (signal.aborted) return;
      if (permission.location !== 'granted') {
        say('Cần quyền vị trí để chia sẻ. Mở cài đặt và cho Homie dùng vị trí nhé.');
        extra.replaceChildren(button('Mở cài đặt', 'secondary-button', () => share.openAppSettings()));
        return;
      }
      const current = await share.status();
      if (signal.aborted) return;
      if (current.battery < 20 && !current.charging) { say('Pin dưới 20%. Sạc thêm rồi bật lại nhé.'); return; }
      if (!current.ignoringBatteryOptimizations) await share.openBatterySettings().catch(() => {});
      await share.start({ serverUrl: location.origin });
      if (signal.aborted) return;
      const tips = document.createElement('p');
      tips.className = 'location-hint';
      tips.textContent = batteryTips(current.manufacturer);
      extra.replaceChildren(tips, button('Mở cài đặt ứng dụng', 'secondary-button', () => share.openAppSettings()));
      onChange();
    } catch {
      if (!signal.aborted) say('Chưa bật được chia sẻ. Thử lại nhé.');
    } finally {
      busy = false;
      if (!signal.aborted) await load();
    }
  }

  async function stop() {
    busy = true; show();
    try { await share.stop(); onChange(); }
    catch { if (!signal.aborted) say('Chưa dừng được. Thử lại nhé.'); }
    finally { busy = false; if (!signal.aborted) await load(); }
  }

  // The service can stop on its own (low battery, the notification's button), so look again when the app returns.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); }, { signal });
  load();
  return { root, cleanup: () => root.remove() };
}
