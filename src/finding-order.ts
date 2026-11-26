/** Source offsets, longest first at a shared start; stable sort retains file-order ties. */
export function compareSourcePosition(
  a: { span?: { start: number; end: number }; target?: unknown },
  b: { span?: { start: number; end: number }; target?: unknown },
) {
  return (
    Number(!!a.target) - Number(!!b.target) ||
    (a.span?.start ?? Infinity) - (b.span?.start ?? Infinity) ||
    (b.span?.end ?? Infinity) - (a.span?.end ?? Infinity) ||
    0
  );
}
