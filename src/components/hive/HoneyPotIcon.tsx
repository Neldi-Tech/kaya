// HoneyPotIcon — the real Kaya Honey Pot artwork (golden pot brimming
// with coins), replacing the plain 🍯 emoji wherever the pot appears as
// a standalone icon. Inline-in-a-sentence 🍯 (money labels, rate levers,
// amounts) keep the emoji glyph — a raster mid-sentence reads broken.
//
// The asset lives at /public/honey-pot.png — transparent PNG, 512² master,
// rendered down per use. `size` controls both dimensions (square art).

type Props = {
  size?: number;
  className?: string;
  title?: string;
};

export default function HoneyPotIcon({ size = 28, className = '', title = 'Honey Pot' }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/honey-pot.png"
      alt={title}
      width={size}
      height={size}
      className={`inline-block object-contain align-middle select-none ${className}`}
      draggable={false}
    />
  );
}
