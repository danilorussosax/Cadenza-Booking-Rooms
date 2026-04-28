import { Monitor, Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  /** "icon" = round button (default). "compact" = same but smaller. "labeled" = shows text */
  variant?: 'icon' | 'compact' | 'labeled';
  /** Optional Tailwind utility for the button container (background, border) */
  buttonClassName?: string;
}

const LABEL: Record<ReturnType<typeof useTheme>['theme'], string> = {
  light: 'Tema chiaro',
  dark: 'Tema scuro',
  system: 'Tema di sistema',
};

export function ThemeToggle({ className, variant = 'icon', buttonClassName }: Props) {
  const { theme, toggle } = useTheme();

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  if (variant === 'labeled') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={toggle}
        className={cn('gap-2', className, buttonClassName)}
        title={`Cambia tema (attuale: ${LABEL[theme]})`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-2"
          >
            <Icon className="h-4 w-4" />
            <span>{LABEL[theme]}</span>
          </motion.span>
        </AnimatePresence>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size={variant === 'compact' ? 'sm' : 'icon'}
      onClick={toggle}
      className={cn(className, buttonClassName)}
      title={`Cambia tema (attuale: ${LABEL[theme]}) — clic per ciclare`}
      aria-label={LABEL[theme]}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="inline-flex"
        >
          <Icon className="h-4 w-4" />
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
