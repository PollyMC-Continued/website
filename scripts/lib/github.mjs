import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const dataDir = resolve(root, 'src/data');

export function ghApi(path) {
	return `https://api.github.com/repos/corecommit/PollyMC-Continued${path}`;
}

export function rawFile(path) {
	return `https://raw.githubusercontent.com/corecommit/PollyMC-Continued/main/${path}`;
}

export async function ghFetch(url) {
	const headers = { Accept: 'application/vnd.github+json' };
	const token = process.env.GITHUB_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(url, { headers });
	if (!res.ok) {
		throw new Error(`GitHub request failed: ${res.status} ${res.statusText} — ${url}`);
	}
	return res;
}

export async function ghJson(url) {
	const res = await ghFetch(url);
	return res.json();
}

export async function writeJson(filename, data) {
	const file = resolve(dataDir, filename);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
	console.log(`✓ ${file}`);
}

export async function writeText(filename, text) {
	const file = resolve(dataDir, filename);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, text, 'utf8');
	console.log(`✓ ${file}`);
}

export async function readCachedText(filename) {
	try {
		return await readFile(resolve(dataDir, filename), 'utf8');
	} catch {
		return null;
	}
}
