# PollyMC-Continued — Website

The official landing page for **PollyMC-Continued**, a community revival of the PollyMC Minecraft launcher. Built as a static site — no frameworks, no build step, just HTML, CSS, and vanilla JS.

---

## About the Project

PollyMC-Continued picks up where the original PollyMC left off. It syncs against the [Prism Launcher](https://prismlauncher.org/) upstream, adds NeoForge support, and commits to long-term community maintenance. No Microsoft account required. No DRM. Fully open source under GPL-3.0.

This repository contains only the **website source**. For the launcher itself, see the main PollyMC-Continued launcher repository.

---

## Stack

- **HTML5** — semantic, single-page layout
- **CSS3** — custom properties, CSS Grid, Flexbox, no preprocessor
- **Vanilla JS** — IntersectionObserver scroll reveals, mobile nav toggle, FAQ accordion
- **Fonts** — Bebas Neue, IBM Plex Mono, IBM Plex Sans (Google Fonts)
- **Icons** — Font Awesome 6 (CDN)

---

## File Structure

```
.
├── index.html      # Main page — all sections
├── styles.css      # All styles, includes responsive breakpoints
├── app.js          # Scroll reveal, mobile nav, FAQ toggle
├── README.md
└── LICENSE
```

---

## Contributing

Issues and pull requests are welcome. If you spot a visual bug, broken link, or want to add a new section, open an issue first so we can discuss it.

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
