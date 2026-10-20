import { releaseTagUrl } from './constants';

export interface ChangelogListItem {
	html: string;
	cls: string;
}

export type ChangelogBlock =
	| { type: 'version'; version: string; url: string }
	| { type: 'label'; text: string; cls: string }
	| { type: 'list'; items: ChangelogListItem[] }
	| { type: 'paragraph'; html: string };

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
	return s
		.replace(/``\s*(.+?)\s*``/g, '<code>$1</code>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function sectionClass(label: string): string {
	const key = label.trim().toLowerCase();
	if (key.startsWith('fixed') || key.startsWith('fix')) return 'fix';
	if (key.startsWith('added') || key.startsWith('add')) return 'add';
	if (key.startsWith('removed') || key.startsWith('rem')) return 'rem';
	return '';
}

function markerClass(item: string): { rest: string; cls: string } {
	const m = item.match(/^\[(.)\]\s*(.*)$/);
	if (m) {
		const cls = sectionClass(m[1]);
		return { rest: m[2], cls };
	}
	return { rest: item, cls: '' };
}

/**
 * Parses the launcher's CHANGELOG.md into renderable blocks.
 * Supports the current format (`## vX.Y.Z` + `**Fixed:**` labels) and the
 * legacy `- [F]/[A]/[R]` markers.
 */
export function parseChangelog(md: string): ChangelogBlock[] {
	const lines = md.replace(/\r/g, '').split('\n');
	const blocks: ChangelogBlock[] = [];
	let list: { raw: string; cls: string }[] = [];
	let listCls = '';

	function closeList() {
		if (list.length) {
			blocks.push({
				type: 'list',
				items: list.map((i) => ({ html: inline(escapeHtml(i.raw)), cls: i.cls })),
			});
			list = [];
			listCls = '';
		}
	}

	for (const line of lines) {
		const t = line.trim();
		if (!t) {
			closeList();
			continue;
		}

		if (t.startsWith('#')) {
			closeList();
			let level = 0;
			while (t.charAt(level) === '#') level++;
			const text = t.slice(level).trim();
			if (/^changelog$/i.test(text)) continue;
			const version = text.match(/^v?(\d+\.\d+\.\d+)$/);
			blocks.push(
				version
					? { type: 'version', version: text, url: releaseTagUrl(`v${version[1]}`) }
					: { type: 'paragraph', html: `<strong>${escapeHtml(text)}</strong>` },
			);
			continue;
		}

		const label = t.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
		if (label) {
			closeList();
			listCls = sectionClass(label[1]);
			blocks.push({ type: 'label', text: label[1], cls: listCls });
			continue;
		}

		if (t.startsWith('- ') || t.startsWith('* ')) {
			let item = t.slice(2);
			const marker = markerClass(item);
			item = marker.rest;
			const cls = marker.cls || listCls;
			if (marker.cls) listCls = marker.cls;
			list.push({ raw: item, cls });
			continue;
		}

		// Hard-wrapped continuation line of the previous list item
		if (list.length) {
			list[list.length - 1].raw += ' ' + t;
			continue;
		}

		closeList();
		blocks.push({ type: 'paragraph', html: inline(escapeHtml(t)) });
	}
	closeList();

	return blocks;
}
