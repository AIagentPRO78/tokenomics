// Progressive enhancement only — the page is fully readable without JS.
'use strict';

const COPY_RESET_MS = 1400;

// Copy-to-clipboard on command chips.
document.querySelectorAll('.cmd[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const label = btn.querySelector('.copy');
    const prev = label ? label.textContent : '';
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.classList.add('copied');
      if (label) label.textContent = 'copied';
    } catch {
      if (label) label.textContent = 'select + copy';
    }
    setTimeout(() => {
      btn.classList.remove('copied');
      if (label) label.textContent = prev;
    }, COPY_RESET_MS);
  });
});

// Staggered reveal-on-scroll. Anything still hidden shows immediately when
// reduced motion is requested or IntersectionObserver is unavailable.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hidden = document.querySelectorAll('.reveal:not(.in)');

if (reduceMotion || !('IntersectionObserver' in window)) {
  hidden.forEach((el) => el.classList.add('in'));
} else {
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          obs.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 }
  );
  hidden.forEach((el) => observer.observe(el));
}
