const tabs = document.querySelectorAll<HTMLAnchorElement>('.download-tabs a');

function select(tab: HTMLAnchorElement) {
	tabs.forEach((t) => {
		const on = t === tab;
		t.setAttribute('aria-selected', on ? 'true' : 'false');
		t.parentElement?.classList.toggle('download-tab-active', on);
		const controls = t.getAttribute('aria-controls');
		if (controls) document.getElementById(controls)?.classList.toggle('hidden', !on);
	});
}

tabs.forEach((t) => {
	t.addEventListener('click', (e) => {
		e.preventDefault();
		select(t);
	});
});

const hash = (window.location.hash || '').slice(1);
const match = Array.from(tabs).find((t) => t.getAttribute('aria-controls') === `panel-${hash}`);
select(match || tabs[0]);
