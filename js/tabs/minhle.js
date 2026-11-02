import { renderProfile } from '../profile.js';

// Bố cục của Minh Lê được thay đổi trong code; chữ và ảnh đại diện sửa qua nút Edit.
const definition = {
  id: 'minhle',
  displayName: 'Minh Lê',
  accent: '#6e7b5b',
  psi: true,
};

export function render(container, context) {
  return renderProfile(container, context, definition);
}
