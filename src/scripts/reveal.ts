const io = new IntersectionObserver(
	(entries) => {
		entries.forEach((e) => {
			if (e.isIntersecting) {
				e.target.classList.add('in');
				io.unobserve(e.target);
			}
		});
	},
	{ threshold: 0.2 },
);

document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
