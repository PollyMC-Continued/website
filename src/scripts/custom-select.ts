export interface SelectOption {
	value: string;
	label: string;
}

export interface CustomSelectController {
	getValue: () => string;
	setValue: (value: string, silent?: boolean) => void;
	setOptions: (options: SelectOption[], selectedValue?: string) => void;
}

export function initCustomSelect(
	root: HTMLElement,
	options: SelectOption[],
	initialValue: string,
	onChange?: (value: string) => void
): CustomSelectController {
	let items = [...options];
	let currentValue = initialValue;
	let activeIndex = Math.max(
		0,
		items.findIndex((o) => o.value === currentValue)
	);

	root.classList.add('c-select');
	root.dataset.open = 'false';

	const labelId = root.dataset.labelId;
	const trigger = document.createElement('button');
	trigger.type = 'button';
	trigger.className = 'c-select-trigger';
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	if (labelId) trigger.setAttribute('aria-labelledby', labelId);

	const labelSpan = document.createElement('span');
	labelSpan.className = 'c-select-label';
	const chevron = document.createElement('span');
	chevron.className = 'c-select-chevron';
	chevron.setAttribute('aria-hidden', 'true');
	trigger.append(labelSpan, chevron);

	const menu = document.createElement('ul');
	menu.className = 'c-select-menu';
	menu.setAttribute('role', 'listbox');
	menu.tabIndex = -1;

	root.textContent = '';
	root.append(trigger, menu);

	function renderMenu(): void {
		menu.textContent = '';
		items.forEach((opt, i) => {
			const li = document.createElement('li');
			li.className = 'c-select-option';
			if (i === activeIndex) li.classList.add('is-active');
			li.setAttribute('role', 'option');
			li.dataset.value = opt.value;
			li.setAttribute('aria-selected', opt.value === currentValue ? 'true' : 'false');
			li.textContent = opt.label;
			li.addEventListener('click', (e) => {
				e.stopPropagation();
				selectValue(opt.value);
				close();
				trigger.focus();
			});
			li.addEventListener('mouseenter', () => {
				activeIndex = i;
				syncActive();
			});
			menu.append(li);
		});
		const selected = items.find((o) => o.value === currentValue) ?? items[0];
		labelSpan.textContent = selected ? selected.label : '';
	}

	function syncActive(): void {
		const nodes = menu.querySelectorAll<HTMLLIElement>('.c-select-option');
		nodes.forEach((n, i) => {
			n.classList.toggle('is-active', i === activeIndex);
			if (i === activeIndex) n.scrollIntoView({ block: 'nearest' });
		});
	}

	function open(): void {
		// Close any other open custom selects first
		document.querySelectorAll<HTMLElement>('.c-select[data-open="true"]').forEach((el) => {
			if (el !== root) {
				el.dataset.open = 'false';
				el.querySelector('.c-select-trigger')?.setAttribute('aria-expanded', 'false');
			}
		});
		activeIndex = Math.max(
			0,
			items.findIndex((o) => o.value === currentValue)
		);
		root.dataset.open = 'true';
		trigger.setAttribute('aria-expanded', 'true');
		syncActive();
	}

	function close(): void {
		root.dataset.open = 'false';
		trigger.setAttribute('aria-expanded', 'false');
	}

	function selectValue(val: string, silent = false): void {
		const idx = items.findIndex((o) => o.value === val);
		if (idx === -1) return;
		const changed = currentValue !== val;
		currentValue = val;
		activeIndex = idx;
		renderMenu();
		if (changed && !silent) onChange?.(val);
	}

	trigger.addEventListener('click', (e) => {
		e.stopPropagation();
		if (root.dataset.open === 'true') close();
		else open();
	});

	trigger.addEventListener('keydown', (e) => {
		const isOpen = root.dataset.open === 'true';
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!isOpen) {
				open();
				return;
			}
			const dir = e.key === 'ArrowDown' ? 1 : -1;
			activeIndex = (activeIndex + dir + items.length) % items.length;
			syncActive();
		} else if (e.key === 'Home' && isOpen) {
			e.preventDefault();
			activeIndex = 0;
			syncActive();
		} else if (e.key === 'End' && isOpen) {
			e.preventDefault();
			activeIndex = Math.max(0, items.length - 1);
			syncActive();
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (!isOpen) open();
			else if (items[activeIndex]) {
				selectValue(items[activeIndex].value);
				close();
			}
		} else if (e.key === 'Escape' && isOpen) {
			e.preventDefault();
			close();
		} else if (e.key === 'Tab' && isOpen) {
			close();
		}
	});

	document.addEventListener('click', (e) => {
		if (!root.contains(e.target as Node)) close();
	});

	renderMenu();

	return {
		getValue: () => currentValue,
		setValue: (val: string, silent = false) => selectValue(val, silent),
		setOptions: (newOptions: SelectOption[], selectedValue?: string) => {
			items = [...newOptions];
			if (selectedValue !== undefined) currentValue = selectedValue;
			else if (!items.some((o) => o.value === currentValue)) currentValue = items[0]?.value ?? '';
			activeIndex = Math.max(
				0,
				items.findIndex((o) => o.value === currentValue)
			);
			renderMenu();
		},
	};
}
