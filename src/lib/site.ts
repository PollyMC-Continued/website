import type { ImageMetadata } from 'astro';
import windowsImg from '../assets/windows.png';
import linuxImg from '../assets/linux.png';

export { github, links, releaseTagUrl } from './constants';

export const site = {
	name: 'PollyMC-Continued',
	// TODO: replace when the new domain is configured
	url: 'https://pollymc.vercel.app',
	backgroundImage: 'https://pollymc.vercel.app/background.png',
};

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
