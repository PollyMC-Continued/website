import { ghApi, ghFetch, ghJson, rawFile, readCachedText, writeJson, writeText } from './lib/github.mjs';

const MAX_RELEASE_PAGES = 10;
const REPO = 'corecommit/PollyMC-Continued';

async function syncChangelog() {
	try {
		const res = await ghFetch(rawFile('CHANGELOG.md'));
		const md = await res.text();
		await writeText('changelog.md', md);
		console.log('✓ changelog.md fetched from raw.githubusercontent.com');
	} catch (err) {
		console.warn(`! changelog: ${err.message} — keeping existing cache`);
		if (!(await readCachedText('changelog.md'))) throw err;
	}
}

async function syncReleases() {
	const latest = await ghJson(ghApi('/releases/latest'));

	let totalDownloads = 0;
	for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
		const releases = await ghJson(ghApi(`/releases?per_page=100&page=${page}`));
		if (!Array.isArray(releases) || releases.length === 0) break;
		for (const rel of releases) {
			for (const asset of rel.assets || []) {
				totalDownloads += asset.download_count || 0;
			}
		}
		if (releases.length < 100) break;
	}

	await writeJson('releases.json', {
		fetchedAt: new Date().toISOString(),
		latest: {
			tag_name: latest.tag_name,
			assets: (latest.assets || []).map((a) => ({
				name: a.name,
				browser_download_url: a.browser_download_url,
			})),
		},
		totalDownloads,
	});
	console.log(`✓ releases.json (latest ${latest.tag_name}, ${totalDownloads} total downloads)`);
}

async function syncContributors() {
	const data = await ghJson(ghApi('/contributors?per_page=100'));
	await writeJson('contributors.json', data.map((c) => ({
		login: c.login,
		html_url: c.html_url,
		avatar_url: c.avatar_url,
		contributions: c.contributions,
	})));
	console.log(`✓ contributors.json (${data.length} contributors)`);
}

async function main() {
	console.log(`Synchronizing data from GitHub (${REPO})…`);
	const tasks = [
		syncChangelog().catch((err) => {
			console.error(`✗ changelog failed: ${err.message}`);
			process.exitCode = 1;
		}),
		syncReleases().catch((err) => {
			console.error(`✗ releases failed: ${err.message}`);
			process.exitCode = 1;
		}),
		syncContributors().catch((err) => {
			console.error(`✗ contributors failed: ${err.message}`);
			process.exitCode = 1;
		}),
	];
	await Promise.all(tasks);
	if (!process.exitCode) console.log('Sync complete.');
}

main();
