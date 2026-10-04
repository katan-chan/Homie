import { login } from './auth.js';

export function renderLogin(container, { signal, onSuccess }) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'auth-page';
  section.innerHTML = `
    <div class="account-card">
      <p class="page-eyebrow">Góc riêng của chúng mình</p>
      <h1>Đăng nhập</h1>
      <p class="account-description">Đăng nhập để chỉnh sửa hồ sơ của bạn và các bảng ghi chú.</p>
      <form class="login-form">
        <label for="login-account">Tên đăng nhập</label>
        <input id="login-account" name="accountId" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="minhle hoặc haiyen">
        <label for="login-password">Mật khẩu</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <p class="login-error form-message" role="alert"></p>
        <button class="primary-button" type="submit">Đăng nhập</button>
      </form>
    </div>`;
  container.replaceChildren(section);
  const form = section.querySelector('form');
  const button = form.querySelector('button');
  const message = section.querySelector('.login-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = '';
    try {
      await login(form.elements.accountId.value.trim(), form.elements.password.value, { signal });
      form.elements.password.value = '';
      if (!signal.aborted) onSuccess();
    } catch (error) {
      if (signal.aborted) return;
      message.textContent = error.status === 401 ? 'Tên đăng nhập hoặc mật khẩu chưa đúng.'
        : error.status === 429 ? 'Bạn đã thử nhiều lần. Hãy thử lại sau.'
        : 'Chưa thể đăng nhập. Hãy kiểm tra kết nối máy chủ rồi thử lại.';
    } finally {
      if (!signal.aborted) button.disabled = false;
    }
  }, { signal });
  return () => {
    form.elements.password.value = '';
    section.remove();
  };
}
