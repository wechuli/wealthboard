export default function Loading() {
  return (
    <div aria-label="Loading" className="animate-pulse space-y-6 motion-reduce:animate-none">
      <div className="h-9 w-52 rounded-lg bg-white/[0.06]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 rounded-2xl border border-white/[0.05] bg-white/[0.03]" />
        ))}
      </div>
      <div className="h-96 rounded-2xl border border-white/[0.05] bg-white/[0.03]" />
    </div>
  );
}
