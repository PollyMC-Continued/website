import { parseChangelog, type ChangelogBlock } from '../lib/changelog';
import { rawBase } from '../lib/constants';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlock(block: ChangelogBlock): string {
	switch (block.type) {
		case 'version':
			return `<h2><a href="${esc(block.url)}" target="_blank" rel="noopener">${esc(block.version)}</a></h2>`;
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

async function run(): Promise<void> {
	const container = document.querySelector<HTMLElement>('.changelog');
	if (!container) return;

	try {
		const res = await fetch(`${rawBase}/CHANGELOG.md`);
		if (!res.ok) throw new Error(`GitHub request failed (${res.status})`);
		const md = await res.text();
		container.innerHTML = parseChangelog(md).map(renderBlock).join('');
	} catch {
		container.innerHTML = '<p>Could not load the changelog.</p>';
	}
}

run();