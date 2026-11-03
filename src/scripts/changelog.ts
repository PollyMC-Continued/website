import { parseChangelog, type ChangelogBlock } from '../lib/changelog';
import { rawBase } from '../lib/constants';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlock(block: ChangelogBlock): string {
	switch (block.type) {
		case 'version':
			return '';
		case 'label':
			return `<h3 class="${block.cls ? `tag ${block.cls}` : ''}">${esc(block.text)}</h3>`;
		case 'list':
			return `<ul>${block.items
				.map((item) => `<li class="${item.cls ? `tag ${item.cls}` : ''}">${item.html}</li>`)
				.join('')}</ul>`;
		case 'paragraph':
			return `<p>${block.html}</p>`;
	}
}

const DURATION = 340;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const running = new WeakMap<HTMLDetailsElement, Animation[]>();

function stop(details: HTMLDetailsElement): void {
	running.get(details)?.forEach((a) => a.cancel());
	running.delete(details);
}

/** Opens or closes a changelog entry with a height + fade animation. */
function toggle(details: HTMLDetailsElement, opening: boolean): void {
	const body = details.querySelector<HTMLElement>('.cl-body');
	if (!body || reducedMotion.matches) {
		details.classList.remove('is-closing');
		details.open = opening;
		return;
	}

	const startH = details.offsetHeight;
	stop(details);

	if (opening) {
		details.classList.remove('is-closing');
		details.open = true;
		const endH = details.offsetHeight;
		const height = details.animate(
			{ height: [`${startH}px`, `${endH}px`] },
			{ duration: DURATION, easing: EASING },
		);
		const fade = body.animate(
			{ opacity: [0, 1], transform: ['translateY(-8px)', 'translateY(0)'] },
			{ duration: DURATION, easing: EASING },
		);
		running.set(details, [height, fade]);
		height.onfinish = () => running.delete(details);
	} else {
		// Measure the collapsed height without painting
		details.open = false;
		const endH = details.offsetHeight;
		details.open = true;
		details.classList.add('is-closing');
		const height = details.animate(
			{ height: [`${startH}px`, `${endH}px`] },
			{ duration: DURATION, easing: EASING, fill: 'forwards' },
		);
		const fade = body.animate(
			{ opacity: [1, 0], transform: ['translateY(0)', 'translateY(-8px)'] },
			{ duration: DURATION * 0.7, easing: EASING, fill: 'forwards' },
		);
		running.set(details, [height, fade]);
		height.onfinish = () => {
			details.open = false;
			details.classList.remove('is-closing');
			stop(details);
		};
	}
}

function bindToggles(container: HTMLElement): void {
	container.querySelectorAll<HTMLDetailsElement>('details.cl-version').forEach((details) => {
		const summary = details.querySelector('summary');
		summary?.addEventListener('click', (e) => {
			e.preventDefault();
			const opening = !details.open || details.classList.contains('is-closing');
			toggle(details, opening);
		});
	});
}

async function run(): Promise<void> {
	const container = document.querySelector<HTMLElement>('.changelog');
	if (!container) return;

	try {
		const res = await fetch(`${rawBase}/CHANGELOG.md`);
		if (!res.ok) throw new Error(`GitHub request failed (${res.status})`);
		const md = await res.text();
		const blocks = parseChangelog(md);
		const groups: { version?: Extract<ChangelogBlock, { type: 'version' }>; body: ChangelogBlock[] }[] = [];
		for (const b of blocks) {
			if (b.type === 'version') groups.push({ version: b, body: [] });
			else if (groups.length) groups[groups.length - 1].body.push(b);
			else groups.push({ body: [b] });
		}
		container.innerHTML = groups
			.map((g) =>
				g.version
					? `<details class="cl-version"><summary>Changelog for ${esc(g.version.version)}</summary><div class="cl-body">${g.body.map(renderBlock).join('')}<a class="cl-release" href="${esc(g.version.url)}" target="_blank" rel="noopener">View release on GitHub</a></div></details>`
					: `<div class="cl-body">${g.body.map(renderBlock).join('')}</div>`,
			)
			.join('');
		bindToggles(container);

		// Auto-open the latest release with the same animation
		const latest = container.querySelectorAll<HTMLDetailsElement>('details.cl-version')[0];
		if (latest) {
			requestAnimationFrame(() => requestAnimationFrame(() => toggle(latest, true)));
		}
	} catch {
		container.innerHTML = '<p>Could not load the changelog.</p>';
	}
}

run();