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