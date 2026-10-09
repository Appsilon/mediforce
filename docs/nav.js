// Shared site navigation — include from any page depth.
// Resolves base path from the script's own src attribute.
(function () {
  if (location.hostname === 'mediforce.ai' && location.pathname.endsWith('.html')) {
    history.replaceState(null, '', location.pathname.replace(/(index)?\.html$/, '') + location.search + location.hash);
  }

  const scriptEl = document.currentScript;
  const src = scriptEl?.getAttribute('src') || '';
  const p = src.replace(/nav\.js(\?.*)?$/, '');

  const LINKS = [
    {
      label: 'Case Studies',
      href: 'case-studies/',
      children: [
        { href: 'case-studies/data-delivery/', label: 'Data Delivery' },
        { href: 'case-studies/collecting-documents/', label: 'Collecting Documents' },
      ],
    },
    { href: 'validated-ai.html', label: 'Validation' },
    { href: 'security.html', label: 'Security' },
    { href: 'fda-principles.html', label: 'FDA Alignment' },
    { href: 'news.html', label: 'News' },
    { href: 'setup/', label: 'Self-host' },
    // Absolute: /docs/ is the Docusaurus build pages.yml mounts, not a sibling file.
    { href: 'https://mediforce.ai/docs/', label: 'Docs', external: true },
  ];

  const GH = 'https://github.com/Appsilon/mediforce';
  const ghIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

  const path = location.pathname;
  function isActive(href) {
    const full = new URL(p + href, location.href).pathname;
    if (href.endsWith('/')) return path.startsWith(full);
    return path.endsWith(href) || path.endsWith(href.replace('.html', ''));
  }
  function groupActive(l) {
    return (l.href !== undefined && isActive(l.href)) || l.children.some(c => isActive(c.href));
  }

  const chevronIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="header-dropdown-chevron"><polyline points="6 9 12 15 18 9"/></svg>';

  const desktopLinks = LINKS.map(l => {
    if (l.children) {
      const active = groupActive(l);
      const items = l.children.map(c =>
        `<a href="${p}${c.href}" class="header-dropdown-item${isActive(c.href) ? ' header-dropdown-item--active' : ''}">${c.label}</a>`
      ).join('');
      return `<div class="header-dropdown">
        <a href="${p}${l.href}" class="header-link header-dropdown-trigger${active ? ' header-link--active' : ''}" aria-haspopup="true" aria-expanded="false">${l.label}${chevronIcon}</a>
        <div class="header-dropdown-menu">${items}</div>
      </div>`;
    }
    if (l.external === true) return `<a href="${l.href}" target="_blank" rel="noopener noreferrer" class="header-link">${l.label}</a>`;
    return `<a href="${p}${l.href}" class="header-link${isActive(l.href) ? ' header-link--active' : ''}">${l.label}</a>`;
  }).join('');

  const mobileLinks = LINKS.map(l => {
    if (l.children) {
      const items = l.children.map(c =>
        `<a href="${p}${c.href}" class="mobile-nav-sublink"${isActive(c.href) ? ' style="color:var(--accent,hsl(161 94% 30%));font-weight:600"' : ''}>${c.label}</a>`
      ).join('');
      const label = l.href === undefined
        ? `<div class="mobile-nav-group-label">${l.label}</div>`
        : `<a href="${p}${l.href}"${isActive(l.href) ? ' style="color:var(--accent,hsl(161 94% 30%));font-weight:600"' : ''}>${l.label}</a>`;
      return `${label}${items}`;
    }
    if (l.external === true) return `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`;
    return `<a href="${p}${l.href}"${isActive(l.href) ? ' style="color:var(--accent,hsl(161 94% 30%));font-weight:600"' : ''}>${l.label}</a>`;
  }).join('');

  const html = `
<header class="site-header" id="site-header">
  <div class="header-inner">
    <a href="${p}index.html" class="logo-group">
      <div class="logo-mark"><img src="${p}logo.png" alt="Mediforce logo" /></div>
      <span class="logo-text">Mediforce</span>
    </a>
    <div class="header-links">
      ${desktopLinks}
      <a href="${GH}" target="_blank" class="header-link header-link--icon" aria-label="GitHub">${ghIcon}</a>
      <a href="${p}contact.html" class="header-link header-link--cta">Talk to Our Experts</a>
    </div>
    <button class="nav-toggle" id="site-nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg>
    </button>
  </div>
  <nav class="mobile-nav" id="site-mobile-nav" aria-label="Mobile navigation">
    <a href="${p}index.html" style="color:var(--accent,hsl(161 94% 30%));font-weight:600">Home</a>
    ${mobileLinks}
    <a href="${GH}" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a href="${p}contact.html" class="mobile-nav-cta">Talk to Our Experts</a>
  </nav>
</header>`;


  // Every page ships a static header so the link graph survives without JS.
  // Replacing it keeps one header; prepending would leave two.
  const served = document.getElementById('site-header');
  if (served === null) {
    document.body.insertAdjacentHTML('afterbegin', html);
  } else {
    served.outerHTML = html;
  }

  const toggle = document.getElementById('site-nav-toggle');
  const mobileNav = document.getElementById('site-mobile-nav');

  toggle.addEventListener('click', function () {
    const open = mobileNav.classList.toggle('is-open');
    this.setAttribute('aria-expanded', open);
  });

  const dropdowns = document.querySelectorAll('.header-dropdown');
  function openDropdown(dropdown) {
    dropdown.classList.add('is-open');
    dropdown.querySelector('.header-dropdown-trigger').setAttribute('aria-expanded', true);
    dropdowns.forEach(function (other) {
      if (other !== dropdown) {
        other.classList.remove('is-open');
        other.querySelector('.header-dropdown-trigger').setAttribute('aria-expanded', false);
      }
    });
  }
  dropdowns.forEach(function (dropdown) {
    const trigger = dropdown.querySelector('.header-dropdown-trigger');
    dropdown.addEventListener('mouseenter', function () {
      openDropdown(dropdown);
    });
    if (trigger.tagName === 'A') {
      return;
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dropdown.classList.contains('is-open')) {
        dropdown.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', false);
      } else {
        openDropdown(dropdown);
      }
    });
  });

  function closeDropdowns() {
    dropdowns.forEach(function (dropdown) {
      dropdown.classList.remove('is-open');
      dropdown.querySelector('.header-dropdown-trigger').setAttribute('aria-expanded', false);
    });
  }

  document.addEventListener('click', function (e) {
    if (mobileNav.classList.contains('is-open') &&
        !mobileNav.contains(e.target) && !toggle.contains(e.target)) {
      mobileNav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', false);
    }
    if (!Array.from(dropdowns).some(function (d) { return d.contains(e.target); })) {
      closeDropdowns();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDropdowns();
  });
})();
