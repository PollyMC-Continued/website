const obs = new IntersectionObserver(entries => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('in'), i * 60);
      obs.unobserve(e.target);
    }
  });
}, { threshold: 0.08 });
document.querySelectorAll('.r').forEach(el => obs.observe(el));

document.querySelectorAll('details').forEach(d => {
  d.addEventListener('toggle', () => {
    const icon = d.querySelector('.sq i');
    icon.className = d.open ? 'fa-solid fa-minus' : 'fa-solid fa-plus';
  });
});

const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const hamburgerIcon = document.getElementById('hamburger-icon');
hamburger.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', isOpen);
  hamburgerIcon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
});
document.querySelectorAll('.mobile-link').forEach(a => {
  a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburgerIcon.className = 'fa-solid fa-bars';
  });
});

// Escape key to close mobile menu and dropdowns
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (mobileMenu.classList.contains('open')) {
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburgerIcon.className = 'fa-solid fa-bars';
    }
    document.querySelectorAll('.dl-dropdown.open').forEach(d => {
      d.classList.remove('open');
      d.querySelector('.dl-dropdown-btn').setAttribute('aria-expanded', 'false');
    });
  }
});

let allReleases = [];
const PLATFORM_CONFIG = [
  { dropdownId: 'dl-win-ver', cardId: 'dl-win', match: r => r.assets.find(a => a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe')) },
  { dropdownId: 'dl-linux-ver', cardId: 'dl-linux', match: r => r.assets.find(a => a.name.endsWith('.AppImage')) },
  { dropdownId: 'dl-mac-ver', cardId: 'dl-mac', match: r => r.assets.find(a => a.name.includes('macOS') && a.name.endsWith('.dmg')) },
];

document.addEventListener('click', () => {
  document.querySelectorAll('.dl-dropdown.open').forEach(d => {
    d.classList.remove('open');
    d.querySelector('.dl-dropdown-btn').setAttribute('aria-expanded', 'false');
  });
});

function initDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const btn = dd.querySelector('.dl-dropdown-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dd.classList.contains('open');
    document.querySelectorAll('.dl-dropdown.open').forEach(d => {
      d.classList.remove('open');
      d.querySelector('.dl-dropdown-btn').setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      dd.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
}

function setDropdownValue(id, tag) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const valueEl = dd.querySelector('.dl-dropdown-value');
  if (valueEl) valueEl.textContent = tag;
  dd.querySelectorAll('.dl-dropdown-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.value === tag);
    item.setAttribute('aria-selected', item.dataset.value === tag);
  });
}

function setDownloadCard(id, asset) {
  const card = document.getElementById(id);
  const file = document.getElementById(id + '-filename');
  const arrow = document.getElementById(id + '-arrow');
  const badge = document.getElementById(id + '-badge');
  card.classList.remove('wip');
  if (arrow) arrow.style.display = '';
  if (badge) badge.style.display = 'none';
  if (asset) {
    card.href = asset.browser_download_url;
    file.textContent = asset.name;
  } else {
    card.classList.add('wip');
    file.textContent = 'Work in progress';
    if (arrow) arrow.style.display = 'none';
    if (badge) badge.style.display = 'inline';
  }
}

async function fetchReleases() {
  try {
    const response = await fetch('https://api.github.com/repos/corecommit/PollyMC-Continued/releases?per_page=10');
    if (!response.ok) throw new Error('Failed to fetch');
    allReleases = await response.json();
    if (!allReleases.length) throw new Error('No releases');
    
    document.querySelectorAll('.app-version').forEach(el => { el.textContent = allReleases[0].tag_name; });
    PLATFORM_CONFIG.forEach(({ dropdownId, cardId, match }) => {
      const dd = document.getElementById(dropdownId);
      if (!dd) return;
      const available = allReleases.filter(r => match(r));
      const menu = dd.querySelector('.dl-dropdown-menu');
      menu.innerHTML = '';
      if (!available.length) {
        const valueEl = dd.querySelector('.dl-dropdown-value');
        const btn = dd.querySelector('.dl-dropdown-btn');
        if (valueEl) valueEl.textContent = 'No builds yet';
        if (btn) btn.disabled = true;
        setDownloadCard(cardId, null);
        return;
      }
      available.forEach(r => {
        const asset = match(r);
        const item = document.createElement('div');
        item.className = 'dl-dropdown-item';
        item.dataset.value = r.tag_name;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = r.tag_name;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          setDropdownValue(dropdownId, r.tag_name);
          setDownloadCard(cardId, asset);
          dd.classList.remove('open');
          dd.querySelector('.dl-dropdown-btn').setAttribute('aria-expanded', 'false');
        });
        menu.appendChild(item);
      });
      initDropdown(dropdownId);
      const first = available[0];
      setDropdownValue(dropdownId, first.tag_name);
      setDownloadCard(cardId, match(first));
    });
  } catch (error) {
    console.error('Error fetching releases:', error);
    // Fallback if API fails
    document.querySelectorAll('.dl-filename').forEach(el => el.textContent = 'Check GitHub');
    document.querySelectorAll('.dl-dropdown-value').forEach(el => el.textContent = 'Unavailable');
    document.querySelectorAll('.dl-dropdown-btn').forEach(btn => btn.disabled = true);
  }
}
fetchReleases();

// ---- Changelog: fetched live from CHANGELOG.md, with a version picker ----
const CHANGELOG_REPO = 'corecommit/PollyMC-Continued';
const CHANGELOG_URL = `https://github.com/${CHANGELOG_REPO}/blob/main/CHANGELOG.md`;
const CATEGORY_META = {
  added: { label: 'Added', cls: 'new', icon: 'fa-solid fa-plus' },
  new: { label: 'New', cls: 'new', icon: 'fa-solid fa-plus' },
  changed: { label: 'Changed', cls: 'improved', icon: 'fa-solid fa-arrow-trend-up' },
  improved: { label: 'Improved', cls: 'improved', icon: 'fa-solid fa-arrow-trend-up' },
  fixed: { label: 'Fixed', cls: 'fixed', icon: 'fa-solid fa-wrench' },
  security: { label: 'Security', cls: 'fixed', icon: 'fa-solid fa-shield-halved' },
  removed: { label: 'Removed', cls: 'removed', icon: 'fa-solid fa-trash' },
  deprecated: { label: 'Deprecated', cls: 'removed', icon: 'fa-solid fa-triangle-exclamation' },
  other: { label: 'Other', cls: 'other', icon: 'fa-solid fa-circle-info' },
};
let changelogVersions = [];

function categoryMeta(rawLabel) {
  const key = rawLabel.trim().toLowerCase().replace(/[^a-z]/g, '');
  return CATEGORY_META[key] || { label: rawLabel.trim(), cls: 'other', icon: 'fa-solid fa-circle-info' };
}

// Parses the repo's CHANGELOG.md (## vX.Y.Z headings, **Category:** blocks, - / * bullets)
function parseChangelog(md) {
  const lines = md.split(/\r?\n/);
  const versions = [];
  let current = null;
  let currentCategory = null;
  let lastTopItem = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const versionMatch = line.match(/^##\s+(v[\w.\-]+)/i);
    if (versionMatch) {
      current = { tag: versionMatch[1], categories: [] };
      versions.push(current);
      currentCategory = null;
      lastTopItem = null;
      continue;
    }
    if (!current) continue;

    // Skip generated anchor lines like [#v910](#v910)
    if (/^\[#.*\]\(#.*\)$/.test(line.trim())) continue;

    const categoryMatch = line.match(/^\*\*([^*:]+):?\*\*\s*:?\s*$/);
    if (categoryMatch) {
      const meta = categoryMeta(categoryMatch[1]);
      currentCategory = { ...meta, items: [] };
      current.categories.push(currentCategory);
      lastTopItem = null;
      continue;
    }

    const bulletMatch = rawLine.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch && currentCategory) {
      const indent = bulletMatch[1].length;
      const text = bulletMatch[2].trim();
      if (indent === 0 || !lastTopItem) {
        lastTopItem = { text, sub: [] };
        currentCategory.items.push(lastTopItem);
      } else {
        lastTopItem.sub.push(text);
      }
    }
  }
  return versions;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderChangelogVersion(tag) {
  const version = changelogVersions.find(v => v.tag === tag);
  const contentEl = document.getElementById('cl-content');
  const versionEl = document.getElementById('cl-version');
  const sourceEl = document.getElementById('cl-source');
  const ghLink = document.getElementById('cl-gh-link');
  if (!version || !contentEl) return;

  versionEl.textContent = version.tag;
  const totalChanges = version.categories.reduce((n, c) => n + c.items.length, 0);
  sourceEl.textContent = `${totalChanges} change${totalChanges === 1 ? '' : 's'} in this release`;
  if (ghLink) {
    const anchor = version.tag.toLowerCase().replace(/[^a-z0-9]/g, '');
    ghLink.href = `${CHANGELOG_URL}#${anchor}`;
  }

  if (!version.categories.length) {
    contentEl.innerHTML = '<div class="cl-error">No notes recorded for this release.</div>';
    return;
  }

  contentEl.innerHTML = version.categories.map(cat => `
    <div class="cl-group">
      <div class="cl-group-head ${cat.cls}"><i class="${cat.icon}"></i> ${escapeHtml(cat.label)}</div>
      <ul>
        ${cat.items.map(item => `
          <li>${escapeHtml(item.text)}${item.sub.length ? `<ul>${item.sub.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}</li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

function buildChangelogDropdown() {
  const dd = document.getElementById('cl-ver-dd');
  if (!dd) return;
  const menu = dd.querySelector('.dl-dropdown-menu');
  menu.innerHTML = '';
  changelogVersions.forEach(v => {
    const item = document.createElement('div');
    item.className = 'dl-dropdown-item';
    item.dataset.value = v.tag;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.textContent = v.tag;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      setDropdownValue('cl-ver-dd', v.tag);
      renderChangelogVersion(v.tag);
      dd.classList.remove('open');
      dd.querySelector('.dl-dropdown-btn').setAttribute('aria-expanded', 'false');
    });
    menu.appendChild(item);
  });
  initDropdown('cl-ver-dd');
  setDropdownValue('cl-ver-dd', changelogVersions[0].tag);
}

async function fetchChangelog() {
  const contentEl = document.getElementById('cl-content');
  try {
    const response = await fetch(`https://api.github.com/repos/${CHANGELOG_REPO}/contents/CHANGELOG.md`);
    if (!response.ok) throw new Error('Failed to fetch changelog');
    const data = await response.json();
    const binary = atob(data.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const markdown = new TextDecoder('utf-8').decode(bytes);
    const versions = parseChangelog(markdown);
    if (!versions.length) throw new Error('No versions found in changelog');

    changelogVersions = versions;
    buildChangelogDropdown();
    renderChangelogVersion(versions[0].tag);
  } catch (error) {
    console.error('Error fetching changelog:', error);
    if (contentEl) {
      contentEl.innerHTML = `<div class="cl-error">Couldn't load the changelog automatically. <a href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer">View it on GitHub</a> instead.</div>`;
    }
    const valueEl = document.querySelector('#cl-ver-dd .dl-dropdown-value');
    const btn = document.querySelector('#cl-ver-dd .dl-dropdown-btn');
    if (valueEl) valueEl.textContent = 'Unavailable';
    if (btn) btn.disabled = true;
  }
}
fetchChangelog();

// Scrollspy for navigation
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-center a');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    const sectionTop = section.offsetTop - 100;
    if (window.scrollY >= sectionTop) {
      current = section.getAttribute('id');
    }
  });
  navLinks.forEach(a => {
    a.classList.remove('active');
    if (a.getAttribute('href') === `#${current}`) {
      a.classList.add('active');
    }
  });
});