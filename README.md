# PollyMC-Continued — Website

The official landing page for **PollyMC-Continued**, a community revival of the PollyMC Minecraft launcher.

Live at **[https://pollymc.vercel.app/](https://pollymc.vercel.app/)** — static site, no frameworks, no build step. Plain HTML, CSS, and vanilla JS.

---

## About the Project

PollyMC-Continued picks up where the original PollyMC left off. It syncs against the [Prism Launcher](https://prismlauncher.org/) upstream, adds NeoForge support, and commits to long-term community maintenance. No Microsoft account required. No DRM. Fully open source under GPL-3.0.

This repository contains only the **website source**. For the launcher itself, see the main [PollyMC-Continued launcher repository](https://github.com/corecommit/PollyMC-Continued).

---

## Stack

- **HTML5** — semantic, multi-page layout with clean URLs (`/changelog/`, `/about/`, `/downloads/`)
- **CSS3** — custom properties, CSS Grid, Flexbox, no preprocessor
- **Vanilla JS** — scroll reveal, tab UI, GitHub API fetches (changelog, contributors, latest release)
- **Fonts** — Rubik (Google Fonts)
- **Assets** — WebP backgrounds, PNG screenshots

---

## File Structure

```
.
├── index.html          # Homepage
├── about/index.html    # About — maintainers + contributors (from GitHub API)
├── changelog/index.html# Changelog (fetched from the launcher repo's CHANGELOG.md)
├── downloads/index.html# Downloads — per-OS tabs, URLs resolved from latest release
├── 404.html            # Not-found page
├── assets/             # background.webp, screenshots (PNG)
├── logo.svg
├── style.css
├── robots.txt
├── sitemap.xml
├── README.md
└── LICENSE
```

---

## Contributing

Issues and pull requests are welcome. If you spot a visual bug or broken link, open an issue first so we can discuss it.

Please keep PRs focused — one fix or feature per PR.

---

## Credits

| Name | Role |
|---|---|
| **fn2006** | Original creator of PollyMC |
| **Community** | Revival and ongoing maintenance |
| **Prism Launcher** | Upstream launcher base |
| **PolyMC** | Prior art / original fork source |

---

## License

The website source code is licensed under the **GNU General Public License v3.0**. See [LICENSE](./LICENSE) for the full text.

PollyMC-Continued is not affiliated with Mojang Studios, Microsoft, PolyMC, or Prism Launcher. Minecraft is a trademark of Mojang Studios.