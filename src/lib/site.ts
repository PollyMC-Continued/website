import type { ImageMetadata } from 'astro';
import windowsImg from '../assets/windows.png';
import linuxImg from '../assets/linux.png';

export const site = {
	name: 'PollyMC-Continued',
	// TODO: replace when the new domain is configured
	url: 'https://pollymc.vercel.app',
	backgroundImage: 'https://pollymc.vercel.app/background.png',
};

export const github = {
	owner: 'corecommit',
	repo: 'PollyMC-Continued',
};

export const links = {
	discord: 'https://discord.gg/FsM3JNTN9z',
	github: `https://github.com/${github.owner}/${github.repo}`,
	license: `https://github.com/${github.owner}/${github.repo}/blob/main/LICENSE`,
	releases: `https://github.com/${github.owner}/${github.repo}/releases`,
};

export function releaseTagUrl(tag: string): string {
	return `${links.releases}/tag/${tag}`;
}

export interface AssetPattern {
	/** Substring used to match a release asset by name. */
	match: string;
	label: string;
	secondary?: boolean;
	note?: string;
}

export interface Platform {
	id: 'windows' | 'macos' | 'linux';
	name: string;
	screenshot?: ImageMetadata;
	title: string;
	assets: AssetPattern[];
	note?: string;
}

export const platforms: Platform[] = [
	{
		id: 'windows',
		name: 'Windows',
		screenshot: windowsImg,
		title: 'Windows Download',
		assets: [
			{ match: '-Windows-Setup.exe', label: 'Installer (.exe)' },
			{ match: '-Windows-portable.zip', label: 'Portable (.zip)', secondary: true },
		],
	},
	{
		id: 'macos',
		name: 'macOS',
		title: 'macOS Download',
		assets: [
			{ match: '-macOS-arm64.dmg', label: 'Disk Image (.dmg)' },
			{ match: '-macOS-arm64.zip', label: 'Archive (.zip)', secondary: true },
		],
		note: 'macOS is currently Apple Silicon / ARM64 only.',
	},
	{
		id: 'linux',
		name: 'Linux',
		screenshot: linuxImg,
		title: 'Linux Download',
		assets: [
			{ match: '-Linux-x86_64.AppImage', label: 'AppImage' },
		],
	},
];

export function findAsset(
	assets: { name: string; browser_download_url: string }[],
	pattern: string,
): string | null {
	const asset = assets.find((a) => a.name.includes(pattern));
	return asset ? asset.browser_download_url : null;
}
