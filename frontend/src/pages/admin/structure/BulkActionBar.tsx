import { AnimatePresence, motion } from 'framer-motion';
import { Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  roomsCount: number;
  buildingsCount: number;
  onClearBuildings: () => void;
  onDeleteBuildings: () => void;
  onClearRooms: () => void;
  onDeleteRooms: () => void;
}

/** Floating bulk action bar */
export function BulkActionBar({
  roomsCount,
  buildingsCount,
  onClearBuildings,
  onDeleteBuildings,
  onClearRooms,
  onDeleteRooms,
}: BulkActionBarProps) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {(roomsCount > 0 || buildingsCount > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
        >
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 px-5 py-3 shadow-2xl backdrop-blur-sm sm:rounded-full">
            {buildingsCount > 0 && (
              <>
                <p className="text-sm">
                  {t(
                    buildingsCount === 1
                      ? 'admin.structure.buildings_selected_one'
                      : 'admin.structure.buildings_selected_other',
                    { count: buildingsCount },
                  )}
                </p>
                <Button variant="ghost" size="sm" onClick={onClearBuildings}>
                  <X className="h-4 w-4" />
                  {t('admin.structure.deselect')}
                </Button>
                <Button variant="destructive" size="sm" onClick={onDeleteBuildings}>
                  <Trash2 className="h-4 w-4" />
                  {t('admin.structure.delete_buildings_selected')}
                </Button>
              </>
            )}
            {roomsCount > 0 && buildingsCount > 0 && (
              <span className="hidden h-6 w-px bg-border sm:block" />
            )}
            {roomsCount > 0 && (
              <>
                <p className="text-sm">
                  {t(
                    roomsCount === 1
                      ? 'admin.structure.rooms_selected_one'
                      : 'admin.structure.rooms_selected_other',
                    { count: roomsCount },
                  )}
                </p>
                <Button variant="ghost" size="sm" onClick={onClearRooms}>
                  <X className="h-4 w-4" />
                  {t('admin.structure.deselect')}
                </Button>
                <Button variant="destructive" size="sm" onClick={onDeleteRooms}>
                  <Trash2 className="h-4 w-4" />
                  {t('admin.structure.delete_selected')}
                </Button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
