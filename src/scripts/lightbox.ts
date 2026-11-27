export function initScreenshotLightbox(selector = '.shot'): void {
	const shots = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) =>
		Boolean(el.querySelector('img'))
	);
	if (shots.length === 0) return;

	let currentIndex = 0;
	let lastTrigger: HTMLElement | null = null;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchIgnored = false;
	let lockedScrollY = 0;

	const overlay = document.createElement('div');
	overlay.className = 'lb-overlay';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', 'Screenshot viewer');
	overlay.hidden = true;

	overlay.innerHTML = `
		<button type="button" class="lb-close" aria-label="Close viewer">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
				<path d="M18 6L6 18M6 6l12 12" />
			</svg>
		</button>
		<button type="button" class="lb-nav lb-prev" aria-label="Previous screenshot">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
				<path d="M15 18l-6-6 6-6" />
			</svg>
		</button>
		<figure class="lb-stage">
			<img class="lb-img" src="" alt="" />
			<figcaption class="lb-caption">
				<span class="lb-alt"></span>
				<span class="lb-counter"></span>
			</figcaption>
		</figure>
		<button type="button" class="lb-nav lb-next" aria-label="Next screenshot">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
				<path d="M9 18l6-6-6-6" />
			</svg>
		</button>
	`;

	document.body.append(overlay);

	const imgEl = overlay.querySelector<HTMLImageElement>('.lb-img')!;
	const altEl = overlay.querySelector<HTMLElement>('.lb-alt')!;
	const counterEl = overlay.querySelector<HTMLElement>('.lb-counter')!;
	const closeBtn = overlay.querySelector<HTMLButtonElement>('.lb-close')!;
	const prevBtn = overlay.querySelector<HTMLButtonElement>('.lb-prev')!;
	const nextBtn = overlay.querySelector<HTMLButtonElement>('.lb-next')!;

	function render(): void {
		const shot = shots[currentIndex];
		const sourceImg = shot?.querySelector<HTMLImageElement>('img');
		if (!sourceImg) return;
		imgEl.src = sourceImg.currentSrc || sourceImg.src;
		imgEl.alt = sourceImg.alt;
		altEl.textContent = sourceImg.alt || 'Screenshot';
		counterEl.textContent = `${currentIndex + 1} / ${shots.length}`;
		const single = shots.length <= 1;
		prevBtn.hidden = single;
		nextBtn.hidden = single;
	}

	function openAt(index: number, trigger: HTMLElement): void {
		currentIndex = (index + shots.length) % shots.length;
		lastTrigger = trigger;
		render();
		overlay.hidden = false;
		requestAnimationFrame(() => overlay.classList.add('is-open'));
		lockScroll();
		closeBtn.focus({ preventScroll: true });
	}

	function close(): void {
		overlay.classList.remove('is-open');
		overlay.hidden = true;
		unlockScroll();
		lastTrigger?.focus({ preventScroll: true });
		lastTrigger = null;
	}

	// position:fixed on the body is the only reliable way to stop the page
	// scrolling behind a modal on iOS; remember where we were and go back.
	function lockScroll(): void {
		lockedScrollY = window.scrollY;
		document.body.style.top = `-${lockedScrollY}px`;
		document.body.classList.add('lb-open');
	}

	function unlockScroll(): void {
		document.body.classList.remove('lb-open');
		document.body.style.top = '';
		const root = document.documentElement;
		root.style.scrollBehavior = 'auto'; // the page has smooth scrolling on: jump, don't animate
		window.scrollTo(0, lockedScrollY);
		root.style.scrollBehavior = '';
	}

	function step(delta: number): void {
		currentIndex = (currentIndex + delta + shots.length) % shots.length;
		render();
	}

	shots.forEach((shot, index) => {
		shot.classList.add('is-clickable');
		shot.setAttribute('tabindex', '0');
		shot.setAttribute('role', 'button');
		const alt = shot.querySelector('img')?.alt || 'screenshot';
		shot.setAttribute('aria-label', `View ${alt}`);

		shot.addEventListener('click', () => openAt(index, shot));
		shot.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openAt(index, shot);
			}
		});
	});

	closeBtn.addEventListener('click', close);
	prevBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		step(-1);
	});
	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		step(1);
	});

	overlay.addEventListener('click', (e) => {
		if (e.target === overlay || e.target === overlay.querySelector('.lb-stage')) close();
	});

	overlay.addEventListener(
		'touchstart',
		(e) => {
			// a second finger means pinch-zoom, not a swipe
			touchIgnored = e.touches.length > 1;
			touchStartX = e.changedTouches[0]?.clientX ?? 0;
			touchStartY = e.changedTouches[0]?.clientY ?? 0;
		},
		{ passive: true }
	);
	overlay.addEventListener(
		'touchend',
		(e) => {
			if (e.touches.length > 0) touchIgnored = true;
			if (touchIgnored) {
				if (e.touches.length === 0) touchIgnored = false;
				return;
			}
			const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX;
			const dy = (e.changedTouches[0]?.clientY ?? 0) - touchStartY;
			// only a mostly-horizontal swipe changes the image
			if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx > 0 ? -1 : 1);
		},
		{ passive: true }
	);
	overlay.addEventListener('touchcancel', () => {
		touchIgnored = false;
	});

	document.addEventListener('keydown', (e) => {
		if (overlay.hidden) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	});
}
