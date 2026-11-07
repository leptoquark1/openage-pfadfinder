/** Title shown top centre over the canvas. Clicks pass through to the canvas. */
export function TitleBar() {
  return (
    <div className="pointer-events-none absolute top-3.5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-panel/85 px-4 py-2 font-mono text-xs tracking-[0.08em] whitespace-nowrap text-fg backdrop-blur-sm">
      {/* Same file as the favicon; BASE_URL keeps it under the Pages sub-path. */}
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={18} height={18} />
      openAge - Pfadfinder Demo
    </div>
  );
}
