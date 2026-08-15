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

export const githubApi = `https://api.github.com/repos/${github.owner}/${github.repo}`;
export const rawBase = `https://raw.githubusercontent.com/${github.owner}/${github.repo}/main`;