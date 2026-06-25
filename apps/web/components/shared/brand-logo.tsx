import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  markClassName?: string;
  wordmark?: boolean;
}

export function BrandLogo({ className, markClassName, wordmark = true }: Readonly<BrandLogoProps>) {
  if (wordmark) {
    return (
      <div className={cn("flex min-w-0 items-center", className)}>
        <img alt="BizBil" className="h-14 max-w-full object-contain" src="/icons/bizbil-wordmark.png" />
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <img alt="BizBil" className={cn("size-9 shrink-0 rounded-md", markClassName)} src="/icons/bizbil-mark.png" />
    </div>
  );
}
