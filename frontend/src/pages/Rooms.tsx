import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Building2,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  Music2,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { institutesApi } from '@/api/institutes';
import { EQUIPMENT_TYPE_OPTIONS, ROOM_TYPE_OPTIONS } from '@/api/structure';
import { roomsApi } from '@/api/rooms';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { buildingColor } from '@/lib/buildingColor';
import { sortRoomsCrossBuilding, sortRoomsForBuilding } from '@/lib/sortRooms';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { toLocalDateTimeInput, fromLocalInput } from '@/lib/date';
import type { Building, EquipmentType, Room, RoomType } from '@/types';

interface AdvancedFilters {
  equipmentType: EquipmentType[];
  minCapacity: number;
  type: RoomType | '';
  from: string; // datetime-local input value (locale)
  to: string; // datetime-local input value (locale)
}

const EMPTY_FILTERS: AdvancedFilters = {
  equipmentType: [],
  minCapacity: 0,
  type: '',
  from: '',
  to: '',
};

export default function Rooms() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [buildingId, setBuildingId] = useState<string>('all');
  const [bookingRoom, setBookingRoom] = useState<Room | null>(null);

  // Filtri avanzati attivi (drive `roomsApi.search`); EMPTY_FILTERS = no-op
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Conta i filtri avanzati attivi (per la badge sul pulsante)
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.equipmentType.length > 0) n += filters.equipmentType.length;
    if (filters.minCapacity > 0) n += 1;
    if (filters.type) n += 1;
    if (filters.from && filters.to) n += 1;
    return n;
  }, [filters]);

  const hasAdvancedFilters = activeFilterCount > 0;
  const hasBuildingFilter = buildingId !== 'all';

  // Strategia di fetch:
  //  - Senza filtri avanzati e senza building filter: institutesApi.listFull()
  //    (richiede già una sola query, ottimale per "vista cataloghi")
  //  - Con filtri avanzati o building filter: roomsApi.search() con i filtri
  //    strutturati. La risposta ritorna un array flat di Room con building
  //    già incluso (compatibile con sortRoomsCrossBuilding).
  const useSearchEndpoint = hasAdvancedFilters || hasBuildingFilter;

  const fullQuery = useQuery({
    queryKey: ['institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
    staleTime: 60_000,
    enabled: !useSearchEndpoint,
  });

  const searchQuery = useQuery({
    queryKey: ['rooms', 'search', filters, buildingId],
    queryFn: () =>
      roomsApi.search({
        equipmentType: filters.equipmentType.length ? filters.equipmentType : undefined,
        minCapacity: filters.minCapacity || undefined,
        building: buildingId !== 'all' ? Number(buildingId) : undefined,
        type: filters.type || undefined,
        from: filters.from ? fromLocalInput(filters.from).toISOString() : undefined,
        to: filters.to ? fromLocalInput(filters.to).toISOString() : undefined,
      }),
    staleTime: 30_000,
    enabled: useSearchEndpoint,
  });

  const isLoading = useSearchEndpoint ? searchQuery.isLoading : fullQuery.isLoading;

  // Lista degli edifici (sempre dalla full query, anche quando il flusso
  // di ricerca usa /rooms/search): ci serve per popolare il <Select>.
  const buildings = useMemo(() => {
    return fullQuery.data?.institutes.flatMap((i) => i.buildings) ?? [];
  }, [fullQuery.data]);

  // Insieme grezzo di Room con `building` valorizzato, comune ai due flussi.
  // Il tipo viene inferito a `(Room & { building: Building })[]` così
  // sortRoomsCrossBuilding e i renderer mantengono accesso a tutti i campi.
  type RoomWithBuilding = Room & { building: Building };
  const rawRooms = useMemo<RoomWithBuilding[]>(() => {
    if (useSearchEndpoint) {
      return (searchQuery.data?.rooms ?? []) as RoomWithBuilding[];
    }
    const fromFull = fullQuery.data?.institutes.flatMap((i) => i.buildings) ?? [];
    return fromFull.flatMap((b) => b.rooms.map((r) => ({ ...r, building: b })));
  }, [useSearchEndpoint, searchQuery.data, fullQuery.data]);

  // Filtro testuale client-side (su tutti i flussi) + sort
  const filteredRooms = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = rawRooms.filter((r) => {
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        r.building.name.toLowerCase().includes(term) ||
        r.floor.toLowerCase().includes(term) ||
        r.equipment?.some((e) => e.name.toLowerCase().includes(term))
      );
    });
    return sortRoomsCrossBuilding(items);
  }, [rawRooms, search]);

  // Raggruppamento per edificio — stesso schema di /admin/structure: ogni
  // gruppo ha header espandibile (chevron + tile colorato + conteggio aule
  // + piani). I gruppi mantengono l'ordine derivato da sortRoomsCrossBuilding,
  // le aule dentro ogni gruppo sono ordinate per piano+nome via
  // sortRoomsForBuilding (consistente con la pagina admin).
  const groups = useMemo(() => {
    const map = new Map<number, { building: Building; rooms: typeof filteredRooms }>();
    for (const r of filteredRooms) {
      const existing = map.get(r.building.id);
      if (existing) {
        existing.rooms.push(r);
      } else {
        map.set(r.building.id, { building: r.building, rooms: [r] });
      }
    }
    // Sort interno per piano+nome (numeric-aware), riusando l'helper admin.
    for (const g of map.values()) {
      g.rooms = sortRoomsForBuilding(g.rooms, g.building);
    }
    return Array.from(map.values());
  }, [filteredRooms]);

  // Stato espansione per gruppo. Default: tutti aperti la prima volta che
  // arrivano dati (l'utente sta sfogliando, vuole vedere subito le aule).
  // L'utente può poi richiudere singoli gruppi e lo stato persiste finché
  // i building non cambiano (es. dopo un filtro che rimuove un edificio).
  const [collapsedBuildings, setCollapsedBuildings] = useState<Set<number>>(new Set());
  const [didInit, setDidInit] = useState(false);
  useEffect(() => {
    if (!didInit && groups.length > 0) {
      setCollapsedBuildings(new Set());
      setDidInit(true);
    }
  }, [groups.length, didInit]);
  const toggleBuilding = (id: number) => {
    setCollapsedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFilters = () => {
    setDraftFilters(filters);
    setFiltersOpen(true);
  };

  const applyDraftFilters = () => {
    setFilters(draftFilters);
    setFiltersOpen(false);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
  };

  const toggleEquipment = (eq: EquipmentType) => {
    setDraftFilters((d) => {
      const has = d.equipmentType.includes(eq);
      return {
        ...d,
        equipmentType: has ? d.equipmentType.filter((e) => e !== eq) : [...d.equipmentType, eq],
      };
    });
  };

  // Helper per il "valore di default" del datetime-range: ora → +2h
  const presetTodayRange = () => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    setDraftFilters((d) => ({
      ...d,
      from: toLocalDateTimeInput(start),
      to: toLocalDateTimeInput(end),
    }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('rooms.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
      </header>

      {/* Filters: text + building + advanced filters trigger */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder={t('rooms.search_placeholder')}
            className="pl-9"
          />
        </div>
        <div className="sm:w-72">
          <Select value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('rooms.all_buildings')}</SelectItem>
              {buildings.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  <span className={cn('font-medium', buildingColor(b.id).text)}>{b.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" onClick={openFilters} className="relative">
              <SlidersHorizontal className="h-4 w-4" />
              {t('rooms.advanced_filters')}
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex flex-col gap-5">
            <SheetHeader>
              <SheetTitle>{t('rooms.advanced_filters')}</SheetTitle>
              <SheetDescription>{t('rooms.advanced_filters_help')}</SheetDescription>
            </SheetHeader>

            {/* Tipo aula */}
            <div className="space-y-2">
              <Label>{t('rooms.filter.type')}</Label>
              <Select
                value={draftFilters.type || 'any'}
                onValueChange={(v) => {
                  setDraftFilters((d) => ({ ...d, type: v === 'any' ? '' : (v as RoomType) }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('rooms.filter.type_any')}</SelectItem>
                  {ROOM_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(ROOM_TYPE_LABEL[o.value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Capacità minima — slider HTML nativo */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="min-cap">{t('rooms.filter.min_capacity')}</Label>
                <span className="text-sm font-medium">
                  {draftFilters.minCapacity === 0
                    ? t('rooms.filter.min_capacity_any')
                    : `≥ ${draftFilters.minCapacity}`}
                </span>
              </div>
              <input
                id="min-cap"
                type="range"
                min={0}
                max={100}
                step={1}
                value={draftFilters.minCapacity}
                onChange={(e) => {
                  setDraftFilters((d) => ({ ...d, minCapacity: Number(e.target.value) || 0 }));
                }}
                className="w-full accent-primary"
              />
            </div>

            {/* Range di disponibilità */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {t('rooms.filter.availability')}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={presetTodayRange}
                  className="h-auto px-2 py-1 text-[11px]"
                >
                  {t('rooms.filter.preset_now')}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="datetime-local"
                  value={draftFilters.from}
                  onChange={(e) => {
                    setDraftFilters((d) => ({ ...d, from: e.target.value }));
                  }}
                  aria-label={t('rooms.filter.from')}
                />
                <Input
                  type="datetime-local"
                  value={draftFilters.to}
                  onChange={(e) => {
                    setDraftFilters((d) => ({ ...d, to: e.target.value }));
                  }}
                  aria-label={t('rooms.filter.to')}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('rooms.filter.availability_help')}
              </p>
            </div>

            {/* Equipment richiesti (multi-select via checkbox) */}
            <div className="space-y-2">
              <Label>{t('rooms.filter.equipment')}</Label>
              <p className="text-[11px] text-muted-foreground">
                {t('rooms.filter.equipment_help')}
              </p>
              <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
                {EQUIPMENT_TYPE_OPTIONS.map((opt) => {
                  const selected = draftFilters.equipmentType.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent',
                        selected && 'bg-accent',
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => {
                          toggleEquipment(opt.value);
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <SheetFooter className="mt-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraftFilters(EMPTY_FILTERS);
                }}
              >
                {t('rooms.filter.reset')}
              </Button>
              <Button type="button" onClick={applyDraftFilters}>
                {t('rooms.filter.apply')}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Active filter chips */}
      {hasAdvancedFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.type && (
            <FilterChip
              label={t(ROOM_TYPE_LABEL[filters.type])}
              onClear={() => {
                setFilters((f) => ({ ...f, type: '' }));
              }}
            />
          )}
          {filters.minCapacity > 0 && (
            <FilterChip
              label={`≥ ${filters.minCapacity} ${t('admin.structure.seats_other', { count: filters.minCapacity })}`}
              onClear={() => {
                setFilters((f) => ({ ...f, minCapacity: 0 }));
              }}
            />
          )}
          {filters.from && filters.to && (
            <FilterChip
              label={`${filters.from.replace('T', ' ')} → ${filters.to.replace('T', ' ')}`}
              onClear={() => {
                setFilters((f) => ({ ...f, from: '', to: '' }));
              }}
            />
          )}
          {filters.equipmentType.map((eq) => (
            <FilterChip
              key={eq}
              label={EQUIPMENT_TYPE_OPTIONS.find((o) => o.value === eq)?.label ?? eq}
              onClear={() => {
                setFilters((f) => ({
                  ...f,
                  equipmentType: f.equipmentType.filter((e) => e !== eq),
                }));
              }}
            />
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
            {t('rooms.filter.reset_all')}
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filteredRooms.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('rooms.no_rooms_filtered_title')}</p>
            <p className="text-sm text-muted-foreground">{t('rooms.no_rooms_filtered_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {/* Aule raggruppate per edificio — stesso schema di /admin/structure:
          header con tile colorato + nome + conteggio aule + piani, e griglia
          delle card aula al di sotto. Espansione/collasso con chevron. */}
      <div className="space-y-4">
        {groups.map((g) => {
          const collapsed = collapsedBuildings.has(g.building.id);
          const colors = buildingColor(g.building.id);
          return (
            <Card key={g.building.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  toggleBuilding(g.building.id);
                }}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
              >
                {collapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                    colors.tile,
                  )}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate font-medium', colors.text)}>{g.building.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(
                      g.rooms.length === 1
                        ? 'admin.structure.rooms_count_one'
                        : 'admin.structure.rooms_count_other',
                      { count: g.rooms.length },
                    )}
                    {g.building.floors.length > 0 && (
                      <>
                        {' · '}
                        {g.building.floors.join(', ')}
                      </>
                    )}
                  </p>
                </div>
              </button>

              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t bg-muted/20"
                >
                  <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                    {g.rooms.map((r, i) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.02 * Math.min(i, 12) }}
                      >
                        <Card className="flex h-full flex-col overflow-hidden">
                          <div className="relative aspect-video w-full overflow-hidden bg-muted">
                            <img
                              src={r.photoUrl ?? '/assets/room-default.svg'}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(e) => {
                                const img = e.currentTarget;
                                if (!img.src.endsWith('/assets/room-default.svg')) {
                                  img.src = '/assets/room-default.svg';
                                }
                              }}
                            />
                            <div className="absolute right-2 top-2">
                              <Badge variant={r.isBookable ? 'success' : 'muted'}>
                                {r.isBookable
                                  ? t('admin.structure.bookable')
                                  : t('admin.structure.not_bookable')}
                              </Badge>
                            </div>
                          </div>

                          <CardContent className="flex flex-1 flex-col gap-3 p-5">
                            <div>
                              <h3 className="font-display text-lg font-medium leading-tight">
                                {r.name}
                              </h3>
                              <p className="text-xs text-muted-foreground">{r.floor}</p>
                            </div>

                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                                <Music2 className="h-3 w-3" />
                                {t(ROOM_TYPE_LABEL[r.type])}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                                <Users className="h-3 w-3" />
                                {t(
                                  r.capacity === 1
                                    ? 'admin.structure.seats_one'
                                    : 'admin.structure.seats_other',
                                  { count: r.capacity },
                                )}
                              </span>
                            </div>

                            {r.equipment && r.equipment.length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  {t('rooms.equipment_label')}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {r.equipment.slice(0, 4).map((e) => (
                                    <span
                                      key={e.id}
                                      className={cn(
                                        'rounded-md border bg-background px-1.5 py-0.5 text-[11px]',
                                        !e.isWorking && 'opacity-50 line-through',
                                      )}
                                    >
                                      {e.name}
                                      {e.quantity > 1 && ` ×${e.quantity}`}
                                    </span>
                                  ))}
                                  {r.equipment.length > 4 && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {t('rooms.equipment_more', { count: r.equipment.length - 4 })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="mt-auto pt-2">
                              <Button
                                variant="outline"
                                className="w-full"
                                disabled={!r.isBookable}
                                onClick={() => {
                                  setBookingRoom(r);
                                }}
                              >
                                <CalendarPlus className="h-4 w-4" />
                                {t('rooms.book_room')}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </Card>
          );
        })}
      </div>

      <BookingFormDialog
        open={!!bookingRoom}
        onOpenChange={(o) => !o && setBookingRoom(null)}
        defaultRoomId={bookingRoom?.id}
        lockRoom
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full hover:bg-primary/20"
        aria-label="Rimuovi filtro"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
