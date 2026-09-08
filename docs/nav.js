// Shared site navigation — include from any page depth.
// Resolves base path from the script's own src attribute.
(function () {
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
    { href: 'setup/', label: 'Self-host' },
    // Absolute: /docs/ is the Docusaurus build pages.yml mounts, not a sibling file.
    { href: 'https://mediforce.ai/docs/', label: 'Docs', external: true },
  ];

  const GH = 'https://github.com/Appsilon/mediforce';
  const DISCORD = 'https://discord.gg/TVx4VkG3C2';
  const ghIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  const discordIcon = '<svg viewBox="0 -28.5 256 256" fill="currentColor" aria-hidden="true"><path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193a161.094 161.094 0 0 0 13.96-22.730 136.208 136.208 0 0 1-21.511-10.366c1.802-1.32 3.564-2.72 5.265-4.18 41.397 19.317 86.378 19.317 127.313 0 1.721 1.46 3.483 2.86 5.265 4.18a136.154 136.154 0 0 1-21.552 10.386 160.794 160.794 0 0 0 13.96 22.710c21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.824 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.015-11.805-23.015-26.18s10.148-26.2 23.015-26.2c12.866 0 23.236 11.824 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/></svg>';

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
      <a href="${DISCORD}" target="_blank" rel="noopener noreferrer" class="header-link header-link--discord">${discordIcon} Join Discord</a>
    </div>
    <button class="nav-toggle" id="site-nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg>
    </button>
  </div>
  <nav class="mobile-nav" id="site-mobile-nav" aria-label="Mobile navigation">
    <a href="${p}index.html" style="color:var(--accent,hsl(161 94% 30%));font-weight:600">Home</a>
    ${mobileLinks}
    <a href="${GH}" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a href="${DISCORD}" target="_blank" rel="noopener noreferrer" class="mobile-nav-discord"><svg width="14" height="14" viewBox="0 -28.5 256 256" fill="currentColor" aria-hidden="true"><path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193a161.094 161.094 0 0 0 13.96-22.730 136.208 136.208 0 0 1-21.511-10.366c1.802-1.32 3.564-2.72 5.265-4.18 41.397 19.317 86.378 19.317 127.313 0 1.721 1.46 3.483 2.86 5.265 4.18a136.154 136.154 0 0 1-21.552 10.386 160.794 160.794 0 0 0 13.96 22.710c21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.824 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.015-11.805-23.015-26.18s10.148-26.2 23.015-26.2c12.866 0 23.236 11.824 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/></svg> Join Discord</a>
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
