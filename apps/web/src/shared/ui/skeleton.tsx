export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ContentSkeleton() {
  return (
    <div className="content-skeleton" aria-hidden="true">
      <div className="skeleton-stack">
        <Skeleton className="skeleton-heading" />
        <Skeleton className="skeleton-description" />
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
