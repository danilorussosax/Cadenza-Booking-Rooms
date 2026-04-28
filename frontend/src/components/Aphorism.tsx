import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuoteItem {
  text: string;
  author: string;
}

const QUOTES: QuoteItem[] = [
  {
    text: 'Senza musica, la vita sarebbe un errore.',
    author: 'Friedrich Nietzsche',
  },
  {
    text: 'La musica è una rivelazione più alta di ogni saggezza e filosofia.',
    author: 'Ludwig van Beethoven',
  },
  {
    text: 'Il silenzio è il solido sfondo sul quale si stacca la nota.',
    author: 'Ferruccio Busoni',
  },
  {
    text: 'La musica esprime ciò che non può essere detto e su cui è impossibile tacere.',
    author: 'Victor Hugo',
  },
  {
    text: 'Dove le parole falliscono, la musica parla.',
    author: 'Hans Christian Andersen',
  },
  {
    text: 'La musica è la lingua universale dell’umanità.',
    author: 'Henry Wadsworth Longfellow',
  },
  {
    text: 'I suoni hanno un significato che le parole non possono mai esprimere.',
    author: 'Edgar Varèse',
  },
  {
    text: 'La musica può cambiare il mondo perché può cambiare le persone.',
    author: 'Bono',
  },
  {
    text: 'La musica è l’arte di pensare con i suoni.',
    author: 'Jules Combarieu',
  },
  {
    text: 'Senza musica, la vita non avrebbe alcun senso.',
    author: 'Wolfgang Amadeus Mozart',
  },
  {
    text: 'La musica è il vino che riempie il calice del silenzio.',
    author: 'Robert Fripp',
  },
  {
    text: 'Se vuoi capire l’universo, pensa in termini di energia, frequenza e vibrazione.',
    author: 'Nikola Tesla',
  },
  {
    text: 'L’arte è la più sublime missione dell’uomo, poiché è l’esercizio del pensiero che cerca di comprendere il mondo e di farlo comprendere.',
    author: 'Auguste Rodin',
  },
  {
    text: 'Suonare significa fare la propria preghiera del giorno: ringraziare la vita per averti fatto musicista.',
    author: 'Riccardo Muti',
  },
  {
    text: 'La musica è poesia che si fa suono.',
    author: 'Eduard Hanslick',
  },
];

export function Aphorism({ className }: { className?: string }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % QUOTES.length);
    }, 9000);
    return () => {
      clearInterval(t);
    };
  }, []);

  const q = QUOTES[idx];

  return (
    <div className={cn('relative mx-auto max-w-md select-none px-2 text-center', className)}>
      <Quote className="absolute -left-1 -top-2 h-4 w-4 rotate-180 text-primary/30" aria-hidden />
      <AnimatePresence mode="wait">
        <motion.figure
          key={idx}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="space-y-1.5"
        >
          <blockquote className="font-display text-sm italic leading-snug text-foreground/85">
            «{q.text}»
          </blockquote>
          <figcaption className="text-[11px] uppercase tracking-wider text-muted-foreground">
            — {q.author}
          </figcaption>
        </motion.figure>
      </AnimatePresence>
    </div>
  );
}
