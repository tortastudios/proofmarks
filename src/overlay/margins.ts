/** Select margin containers by their rendered position, without annotating page nodes. */
export function marginSelectors(root: HTMLElement, contentRight: number) {
  const doc = root.ownerDocument,
    walker = doc.createTreeWalker(root, 4),
    elements = new Set<Element>();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let element = node.parentElement;
    if (
      !node.textContent?.trim() ||
      !element ||
      element.closest('script,style,svg,header,nav,footer,[hidden],[aria-hidden="true"]') ||
      !element.checkVisibility({ checkVisibilityCSS: true })
    )
      continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    if (!rects.length || rects.some(r => r.left < contentRight + 20)) continue;
    while (
      element.parentElement &&
      element.parentElement !== root &&
      element.parentElement.getBoundingClientRect().left >= contentRight + 20
    )
      element = element.parentElement;
    if (element.getBoundingClientRect().left >= contentRight + 20) elements.add(element);
  }
  const outer = [...elements].filter(
    element => ![...elements].some(other => other !== element && other.contains(element)),
  );
  return outer.map(element => {
    const parts: string[] = [];
    for (let e: Element | null = element; e && e !== doc.documentElement; e = e.parentElement) {
      parts.unshift(`${e.localName}:nth-child(${[...e.parentElement!.children].indexOf(e) + 1})`);
    }
    return `html[data-proofmarks-on] > ${parts.join(' > ')}`;
  });
}
export function marginStyles(selectors: readonly string[]) {
  return selectors.length ? `${selectors.join(',')} { opacity: .3 !important; transition: none !important; }` : '';
}
