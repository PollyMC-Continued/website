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

// ─── Visitor Counter (1 count per unique browser, using countapi.dev) ────────
(async () => {
  const COUNT_KEY  = 'pollymc_visited';       // localStorage flag
  const NAMESPACE  = 'pollymc-continued';     // countapi namespace
  const KEY        = 'visitors';              // countapi key
  const el         = document.getElementById('visitor-count');
  if (!el) return;

  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

  const setCount = n => {
    el.innerHTML = fmt(n);
    el.classList.add('visitor-count-in');
  };

  try {
    const alreadyCounted = localStorage.getItem(COUNT_KEY);

    let data;
    if (alreadyCounted) {
      // Just read the current count — don't increment again
      const res = await fetch(`https://api.counterapi.dev/v2/${NAMESPACE}/${KEY}`);
      data = await res.json();
    } else {
      // First visit from this browser — increment
      const res = await fetch(`https://api.counterapi.dev/v2/${NAMESPACE}/${KEY}/up`);
      data = await res.json();
      localStorage.setItem(COUNT_KEY, '1');
    }

    if (typeof data.count === 'number') {
      setCount(data.count);
    } else {
      el.innerHTML = 'N/A';
    }
  } catch {
    el.innerHTML = 'N/A';
  }
})();