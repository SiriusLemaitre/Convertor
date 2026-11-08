export type CropRect = { x: number; y: number; width: number; height: number };
export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
export function validCrop(rect: CropRect | null | undefined): rect is CropRect {
  return !!rect && Object.values(rect).every(Number.isFinite) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1.00000001 && rect.y + rect.height <= 1.00000001;
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function changeCrop(rect: CropRect, handle: string, dx: number, dy: number, minWidth = .005, minHeight = .005): CropRect {
  if (handle === 'move') return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) };
  let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = clamp(right + dx, left + minWidth, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function ratioCrop(ratio: string, width: number, height: number): CropRect {
  const [a, b] = ratio.split(':').map(Number);
  if (!(a > 0 && b > 0)) return fullCrop;
  const w = Math.min(1, height * a / b / width), h = Math.min(1, width * b / a / height);
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}
