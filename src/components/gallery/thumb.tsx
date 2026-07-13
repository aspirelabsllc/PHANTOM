import type { Brand } from "@/lib/brand";

// A generic wireframe apparition for a project. When a brand has been extracted,
// its accent color tints the "lit" strokes.
export function Thumb({ name, accent }: { name: string; accent?: string }) {
  const lit = accent ? { stroke: accent } : undefined;
  return (
    <div className="thumb" role="img" aria-label={`Wireframe apparition of the ${name} site`}>
      <svg viewBox="0 0 320 200" aria-hidden="true">
        <rect className="wire" x="8" y="8" width="304" height="184" rx="3" />
        <rect className="wire lit" x="26" y="26" width="268" height="72" rx="2" style={lit} />
        <line className="wire" x1="44" y1="54" x2="176" y2="54" style={lit} />
        <line className="wire soft" x1="44" y1="70" x2="140" y2="70" />
        <circle className="wire lit" cx="236" cy="61" r="18" style={lit} />
        <rect className="wire soft" x="26" y="114" width="82" height="58" rx="2" />
        <rect className="wire soft" x="119" y="114" width="82" height="58" rx="2" />
        <rect className="wire soft" x="212" y="114" width="82" height="58" rx="2" />
      </svg>
    </div>
  );
}

export function accentOf(brand: Brand | null): string | undefined {
  return brand?.color?.tokens?.[0]?.hex;
}
