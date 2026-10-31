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
	} catch {
		container.innerHTML = '<p>Could not load the changelog.</p>';
	}
}

run();