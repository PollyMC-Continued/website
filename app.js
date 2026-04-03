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

// Mobile nav
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const hamburgerIcon = document.getElementById('hamburger-icon');
hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
  hamburgerIcon.className = mobileMenu.classList.contains('open') ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
});
document.querySelectorAll('.mobile-link').forEach(a => {
  a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    hamburgerIcon.className = 'fa-solid fa-bars';
  });
});

// ─── Visitor Counter (1 count per unique browser, using counterapi CDN) ───────
(async () => {
  const COUNT_KEY = 'pollymc_visited';
  const WORKSPACE = 'pollymc-continued';
  const COUNTER   = 'visitors';
  const el        = document.getElementById('visitor-count');
  if (!el) return;

  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);
  const setCount = n => { el.innerHTML = fmt(n); el.classList.add('visitor-count-in'); };

  // Dynamically load the counterapi browser library
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/counterapi/dist/counter.browser.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  try {
    const client = new Counter({ workspace: WORKSPACE });
    const alreadyCounted = localStorage.getItem(COUNT_KEY);

    let result;
    if (alreadyCounted) {
      result = await client.get(COUNTER);
    } else {
      result = await client.up(COUNTER);
      localStorage.setItem(COUNT_KEY, '1');
    }

    if (typeof result.value === 'number') {
      setCount(result.value);
    } else {
      el.innerHTML = 'N/A';
    }
  } catch {
    el.innerHTML = 'N/A';
  }
})();