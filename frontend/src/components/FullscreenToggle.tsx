import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFullscreen } from '@/hooks/useFullscreen';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function FullscreenToggle({ className }: Props) {
  const { isFullscreen, toggle } = useFullscreen();
  const Icon = isFullscreen ? Minimize2 : Maximize2;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={cn(className)}
      title={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
      aria-label={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
