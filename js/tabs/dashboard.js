export function render(container, { signal }) {
  if (signal.aborted) return () => {};

  const section = document.createElement('section');
  section.className = 'dashboard';
  const card = document.createElement('div');
  card.className = 'dashboard-card';
  const title = document.createElement('h1');
  title.textContent = 'Góc ghi chép';
  const description = document.createElement('p');
  description.textContent = 'Một góc dành cho ghi chú, kỷ niệm và nhật ký.';
  const scope = document.createElement('p');
  scope.textContent = 'Nội dung và cách sử dụng sẽ được thiết kế sau.';
  card.append(title, description, scope);
  section.append(card);
  container.replaceChildren(section);
  return () => section.remove();
}
