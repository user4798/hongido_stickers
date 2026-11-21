// icons.js — 화면에 쓰는 가는 선 아이콘 (선 굵기 1.25px, 직접 그림)
// 사용: <span data-icon="printer"></span> → 페이지가 열릴 때 SVG로 바뀐다.

const ICONS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  printer: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8.5" rx="2"/>' +
    '<rect x="7" y="13.5" width="10" height="7" rx=".6" fill="var(--icon-cut, transparent)"/>' +
    '<circle cx="17" cy="11" r=".5" fill="currentColor"/>',
  settings: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/>' +
    '<circle cx="9" cy="7" r="2.2" fill="var(--icon-cut, transparent)"/>' +
    '<circle cx="15" cy="17" r="2.2" fill="var(--icon-cut, transparent)"/>',
  paper: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><line x1="9" y1="8" x2="15" y2="8"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15l6-6M10 9h5v5"/>',
  replace: '<rect x="3.5" y="5" width="13" height="13" rx="2"/><path d="M3.5 15l3.6-3.6a1.2 1.2 0 0 1 1.7 0L13 15.6"/>' +
    '<circle cx="12.2" cy="9" r="1.2"/><path d="M19 8.5v8a2 2 0 0 1-2 2H9"/><path d="M11 16.5l-2 2 2 2"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  rotateLeft: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7"/>' +
    '<line x1="10.5" y1="10.5" x2="10.5" y2="16.5"/><line x1="13.5" y1="10.5" x2="13.5" y2="16.5"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  chevronLeft: '<path d="M14 7l-5 5 5 5"/>',
  chevronRight: '<path d="M10 7l5 5-5 5"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M6.5 10.5L12 5l5.5 5.5"/>',
  flip: '<line x1="12" y1="3.5" x2="12" y2="20.5" stroke-dasharray="2 2"/><path d="M9 7L3.5 17H9Z"/><path d="M15 7l5.5 10H15Z"/>',
  photoAdd: '<rect x="3.5" y="5" width="13" height="13" rx="2"/><path d="M3.5 15l3.6-3.6a1.2 1.2 0 0 1 1.7 0L13 15.6"/><circle cx="12.2" cy="9" r="1.2"/><line x1="19.5" y1="3" x2="19.5" y2="9"/><line x1="16.5" y1="6" x2="22.5" y2="6"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/>' +
    '<path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>' +
    '<rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
  adjust: '<line x1="4" y1="8" x2="20" y2="8"/><circle cx="15" cy="8" r="2.2" fill="var(--icon-cut, transparent)"/>' +
    '<line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="16" r="2.2" fill="var(--icon-cut, transparent)"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
  shadow: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 8l6.9-2M12 12l8-2.3M12 16l6.9-2"/>',
  droplet: '<path d="M12 3.5C12 3.5 6 10.2 6 14.5a6 6 0 0 0 12 0C18 10.2 12 3.5 12 3.5Z"/>',
  temp: '<path d="M14 14.8V5.5a2 2 0 1 0-4 0v9.3a3.5 3.5 0 1 0 4 0Z"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
  vignette: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><ellipse cx="12" cy="12" rx="5.5" ry="4" stroke-dasharray="2 2"/>',
  grain: '<circle cx="6.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="6" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="17.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="12.5" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="14" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="14" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="6.5" cy="17.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="17" cy="18" r="1" fill="currentColor" stroke="none"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = iconSvg(el.dataset.icon);
    el.classList.add('icon');
  });
}

document.addEventListener('DOMContentLoaded', () => applyIcons());
