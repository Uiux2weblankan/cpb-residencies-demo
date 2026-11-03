/** Header MENU button: opens the full-screen navigation overlay. Shared by all pages. */
export function initSiteMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-site-menu]');
  if (!toggle || !menu) return;
  const label = toggle.querySelector('.site-header__menu-label');

  const set = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (label) label.textContent = open ? 'Close' : 'Menu';
    if (open) menu.querySelector('a')?.focus();
  };

  toggle.addEventListener('click', () => set(menu.hidden));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { set(false); toggle.focus(); }
  });
}
