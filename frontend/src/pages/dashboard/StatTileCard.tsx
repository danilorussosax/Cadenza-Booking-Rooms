import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export interface StatTile {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  tone: string;
  to?: string;
}

export function StatTileCard({ tile, delay }: { tile: StatTile; delay: number }) {
  const card = (
    <Card
      className={
        tile.to
          ? 'h-full transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20'
          : 'h-full'
      }
    >
      <CardContent className="flex items-start gap-2 p-3 sm:gap-3 sm:p-5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${tile.tone}`}
        >
          <tile.icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">
            {tile.label}
          </p>
          <p className="font-display text-xl font-medium sm:text-2xl">{tile.value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">{tile.hint}</p>
        </div>
        {tile.to && (
          <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
        )}
      </CardContent>
    </Card>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="h-full"
    >
      {tile.to ? (
        <Link
          to={tile.to}
          className="block h-full rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  );
}
