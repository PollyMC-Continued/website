import { githubApi } from '../lib/constants';

interface Contributor {
	login: string;
	html_url: string;
	avatar_url: string;
	contributions: number;
}

async function run(): Promise<void> {
	const list = document.querySelector<HTMLElement>('#contributors-list');
	const count = document.querySelector<HTMLElement>('#contributors-count');
	if (!list) return;

	try {
		const res = await fetch(`${githubApi}/contributors?per_page=100`, {
			headers: { Accept: 'application/vnd.github+json' },
		});
		if (!res.ok) throw new Error(`GitHub request failed (${res.status})`);
		const data = (await res.json()) as Contributor[];

		if (count) {
			count.textContent = `${data.length} contributor${data.length === 1 ? '' : 's'}`;
		}

		const ul = document.createElement('ul');
		ul.className = 'people';
		for (const c of data) {
			const li = document.createElement('li');
			const a = document.createElement('a');
			a.href = c.html_url;
			a.target = '_blank';
			a.rel = 'noopener';

			const img = document.createElement('img');
			img.src = `${c.avatar_url}?s=160`;
			img.alt = c.login;
			img.loading = 'lazy';

			const role = document.createElement('span');
			role.className = 'role';
			role.textContent = `${c.contributions} contribution${c.contributions === 1 ? '' : 's'}`;

			a.append(img, document.createTextNode(c.login), role);
			li.append(a);
			ul.append(li);
		}
		list.replaceChildren(ul);
	} catch {
		if (count) count.textContent = 'Could not load contributors.';
	}
}

run();