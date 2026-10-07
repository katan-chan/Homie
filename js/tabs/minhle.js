import { renderProfile } from '../profile.js';

// Bố cục/ảnh của Minh Lê được thay đổi trong code, không qua nút Edit.
const definition = {
  id: 'minhle',
  displayName: 'Minh Lê',
  accent: '#6e7b5b',
  psi: true,
};

export function render(container, context) {
  return renderProfile(container, context, definition);
}
