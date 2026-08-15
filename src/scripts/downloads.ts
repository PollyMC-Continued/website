import { githubApi } from '../lib/constants';

const CACHE_KEY = 'pollymc:releases';
const CACHE_TTL = 10 * 60 * 1000;
const MAX_RELEASE_PAGES = 10;

interface Asset {
	name: string;
	browser_download_url: string;
}

interface Latest {
	tag_name: string;
	assets: Asset[];
}

interface Cache {
	fetchedAt: number;
	latest: Latest;
	totalDownloads: number;
}

async function ghJson(url: string): Promise<unknown> {
	const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
	if (!res.ok) throw new Error(`GitHub request failed (${res.status})`);
	return res.json();
}

async function fetchTotalDownloads(): Promise<number> {
	let total = 0;
	for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
		const releases = (await ghJson(`${githubApi}/releases?per_page=100&page=${page}`)) as {
			assets?: Asset[];
		}[];
		if (!Array.isArray(releases) || releases.length === 0) break;
		for (const rel of releases) {
			for (const asset of rel.assets || []) {
				total += (asset as { download_count?: number }).download_count || 0;
			}
		}
		if (releases.length < 100) break;
	}
	return total;
}

function apply(latest: Latest, totalDownloads: number): void {
	document.querySelectorAll<HTMLElement>('.dl-version .ver').forEach((el) => {
		el.textContent = latest.tag_name;
	});

	document.querySelectorAll<HTMLAnchorElement>('a.dl-button[data-match]').forEach((a) => {
		const match = a.dataset.match;
		const asset = (latest.assets || []).find((x) => x.name.includes(match || ''));
		if (asset) a.href = asset.browser_download_url;
	});

	const num = document.querySelector<HTMLElement>('.downloads-total .num');
	if (num) num.textContent = totalDownloads.toLocaleString();
}

function readCache(): Cache | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw) as Cache;
		if (!data.fetchedAt || Date.now() - data.fetchedAt > CACHE_TTL) return null;
		return data;
	} catch {
		return null;
	}
}

async function run(): Promise<void> {
	const cached = readCache();
	if (cached) {
		apply(cached.latest, cached.totalDownloads);
		return;
	}

	try {
		const [latest, totalDownloads] = await Promise.all([
			ghJson(`${githubApi}/releases/latest`) as Promise<Latest>,
			fetchTotalDownloads(),
		]);
		apply(latest, totalDownloads);
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), latest, totalDownloads }));
		} catch {
			// storage unavailable — fall back to fetching on every load
		}
	} catch {
		// leave the fallback links and placeholders as-is
	}
}

run();