import { renderProfile } from '../profile.js';

// Bố cục/ảnh của Hải Yến được thay đổi trong code, không qua nút Edit.
const definition = {
  id: 'haiyen',
  displayName: 'Hải Yến',
  accent: '#985a74',
};

export function render(container, context) {
  return renderProfile(container, context, definition);
}
