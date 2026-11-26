// proofmarks.dev/faq/: the page view, counted the way the home page counts it, and which questions people
// open. A link to a question (/faq/#key) opens its answer.
import { track } from './analytics';

track('$pageview');
const openLinked = () => {
  const linked = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (linked instanceof HTMLDetailsElement) linked.open = true;
};
openLinked();
addEventListener('hashchange', openLinked);
for (const question of document.querySelectorAll('details'))
  question.addEventListener('toggle', () => {
    if (question.open) track('faq_opened', { question: question.id });
  });
