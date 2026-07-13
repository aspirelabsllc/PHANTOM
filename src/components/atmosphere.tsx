// Fog + vignette + film grain. Fixed, non-interactive, sits beneath everything.
export function Atmosphere() {
  return (
    <>
      <div className="fog" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
    </>
  );
}
