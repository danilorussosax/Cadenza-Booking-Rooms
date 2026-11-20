import { useEffect, useState } from 'react';
import { slideDelayMs, type Slide } from '@/lib/displayRotation';

/**
 * Timer di rotazione: avanza ogni intervalSec della slide corrente.
 * Loop infinito; con 0/1 slide il timer non parte e l'indice torna a 0.
 */
export function useSlideRotation(slides: Slide[]) {
  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => {
    if (slides.length <= 1) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= slides.length) {
      setCurrentIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      setCurrentIndex((i) => (i + 1) % slides.length);
    }, slideDelayMs(slides[currentIndex].intervalSec));
    return () => {
      clearTimeout(timer);
    };
  }, [currentIndex, slides]);

  // `Array.prototype.at()` ha firma `T | undefined`: il `?? null` dà `Slide | null`
  // (null quando `slides` è vuoto, atteso).
  const currentSlide = slides.at(currentIndex) ?? null;
  return { currentIndex, currentSlide };
}
