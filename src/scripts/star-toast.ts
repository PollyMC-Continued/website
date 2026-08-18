import { links } from '../lib/site';

let activeOverlay: HTMLElement | null = null;

function removeToast(overlay: HTMLElement): void {
	overlay.classList.remove('is-visible');
	setTimeout(() => overlay.remove(), 250);
	if (activeOverlay === overlay) activeOverlay = null;
	document.body.classList.remove('star-toast-open');
}

function showStarToast(): void {
	if (activeOverlay) return;

	const overlay = document.createElement('div');
	overlay.className = 'star-toast-overlay';
	overlay.innerHTML = `
		<div class="star-toast" role="dialog" aria-modal="true" aria-label="Support PollyMC-Continued">
			<button type="button" class="star-toast-close" aria-label="Dismiss">&times;</button>
			<p class="star-toast-title">⭐ Thanks for downloading PollyMC-Continued!</p>
			<p class="star-toast-body">I build this solo, not for profit. A star on GitHub takes a few seconds and really helps the project grow.</p>
			<a class="button star-toast-cta" href="${links.github}" target="_blank" rel="noopener">Star on GitHub</a>
		</div>
	`;

	document.body.appendChild(overlay);
	document.body.classList.add('star-toast-open');
	activeOverlay = overlay;

	overlay.querySelector('.star-toast-close')?.addEventListener('click', () => removeToast(overlay));

	requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

document.querySelectorAll<HTMLAnchorElement>('a.dl-button').forEach((btn) => {
	btn.addEventListener('click', () => {
		showStarToast();
	});
});