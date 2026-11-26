/** Avoid Uint8Array.from's per-byte callback overhead. */
export function fontBytes(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)),
    bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
