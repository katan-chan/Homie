import { renderProfile } from '../profile.js';

// Bố cục của Hải Yến được thay đổi trong code; chữ và ảnh đại diện sửa qua nút Edit.
const definition = {
  id: 'haiyen',
  displayName: 'Hải Yến',
  accent: '#985a74',
};

export function render(container, context) {
  return renderProfile(container, context, definition);
}
