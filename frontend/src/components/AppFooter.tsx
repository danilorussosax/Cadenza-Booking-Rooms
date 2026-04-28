import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { institutesApi } from '@/api/institutes';
import { cn } from '@/lib/utils';

const DEFAULT_COPYRIGHT = 'Copyright © 2026 by Danilo Russo';

interface Props {
  className?: string;
  variant?: 'default' | 'subtle';
}

export function AppFooter({ className, variant = 'default' }: Props) {
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });

  const text = data?.institute?.copyright?.trim() ?? DEFAULT_COPYRIGHT;

  return (
    <footer
      className={cn(
        'shrink-0 px-4 py-3 text-center text-[11px] tracking-wider',
        variant === 'subtle' ? 'text-muted-foreground/70' : 'text-muted-foreground',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-4">
        <span className="uppercase">{text}</span>
        <span className="hidden sm:inline">·</span>
        <nav className="flex items-center gap-3 normal-case tracking-normal">
          <Link to="/privacy-policy" className="hover:text-foreground/80">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-foreground/80">
            Termini
          </Link>
        </nav>
      </div>
    </footer>
  );
}
