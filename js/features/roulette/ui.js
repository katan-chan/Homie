// Small DOM and copy helpers shared by the seminar and activity pages. Data always goes through textContent.
export const NAME = { minhle: 'Minh', haiyen: 'Yến' };
export const SEMINAR_CATEGORY = 'Học - Seminar';
export const ACTIVITY_CATEGORIES = ['Trò chuyện', 'Sáng tạo', 'Khám phá', 'Chơi', 'Tự làm', 'Tụi mình', 'Nhảm nhí'];

export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(label, className = 'roulette-btn') {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}
export const vnDate = date => { const [y, m, d] = date.split('-'); return `${+d}/${+m}/${y}`; };
/** Today in Asia/Ho_Chi_Minh, the zone the server checks dates against. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Vietnamese message for a failed request; null when the request was aborted on purpose. */
export function problem(error, conflict = 'Có thay đổi ở nơi khác. Đã tải lại.') {
  if (error?.name === 'AbortError') return null;
  if (error?.status === 409) return conflict;
  return { 400: 'Thông tin chưa hợp lệ.', 401: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.', 404: 'Mục này không còn nữa.' }[error?.status]
    ?? (error?.status ? 'Có lỗi xảy ra. Thử lại nhé.' : 'Không kết nối được máy chủ. Thử lại nhé.');
}
