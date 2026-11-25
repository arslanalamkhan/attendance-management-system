import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Rows3,
  Rows4,
  SearchX,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { readJson, readStorage, writeJson, writeStorage } from '../../lib/storage';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { IconButton } from '../ui/icon-button';
import { Skeleton } from '../ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DEFAULT_PAGE_SIZES, type DataTablePagingState } from './use-data-table-state';

export type Density = 'comfortable' | 'compact';

const DENSITY_KEY = 'nacta-table-density';

function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = React.useState<Density>(() => (readStorage(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'));
  const set = React.useCallback((d: Density) => {
    setDensity(d);
    writeStorage(DENSITY_KEY, d);
  }, []);
  return [density, set];
}

export interface BulkActionContext<TData> {
  rows: TData[];
  ids: string[];
  clear: () => void;
}

export interface DataTableProps<TData> {
  /** Stable id; column visibility is remembered per table id. */
  id: string;
  /** Accessible table name (screen readers). */
  caption: string;
  /**
   * Column `id` must equal the endpoint's sort key for sortable columns.
   * Columns with only an `id` (no accessor) are not sortable.
   */
  columns: ColumnDef<TData>[];
  data: TData[];
  /** Total rows on the server (all pages). */
  total: number;
  state: DataTablePagingState;
  getRowId: (row: TData) => string;
  /** True until the first page of data has arrived. */
  loading?: boolean;
  /** True while a refetch / page change is in flight (data is stale). */
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: TData) => void;
  /** Adds a checkbox column and the floating bulk-action bar. */
  selectable?: boolean;
  bulkActions?: (ctx: BulkActionContext<TData>) => React.ReactNode;
  /** Left side of the toolbar: search, filters. */
  toolbar?: React.ReactNode;
  /** Right side of the toolbar, before the columns / density controls. */
  toolbarActions?: React.ReactNode;
  /** Shown when there are no rows and no filters are active. */
  emptyState?: React.ReactNode;
  rowClassName?: (row: TData) => string | undefined;
  noun?: { singular: string; plural: string };
  pageSizeOptions?: readonly number[];
  /** CSS max-height of the scrolling body (header stays sticky). */
  maxHeight?: string;
  className?: string;
}

export function DataTable<TData>({
  id,
  caption,
  columns,
  data,
  total,
  state,
  getRowId,
  loading = false,
  fetching = false,
  error,
  onRetry,
  onRowClick,
  selectable = false,
  bulkActions,
  toolbar,
  toolbarActions,
  emptyState,
  rowClassName,
  noun = { singular: 'row', plural: 'rows' },
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  maxHeight = 'calc(100dvh - 21rem)',
  className,
}: DataTableProps<TData>) {
  const [density, setDensity] = useDensity();
  const visibilityKey = `nacta-table:${id}:columns`;
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() =>
    readJson<VisibilityState>(visibilityKey, {}),
  );
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const rowCache = React.useRef(new Map<string, TData>());
  const [focusIndex, setFocusIndex] = React.useState(0);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  const onVisibilityChange: OnChangeFn<VisibilityState> = React.useCallback(
    (updater) => {
      setColumnVisibility((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        writeJson(visibilityKey, next);
        return next;
      });
    },
    [visibilityKey],
  );

  const allColumns = React.useMemo<ColumnDef<TData>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<TData> = {
      id: 'select',
      enableSorting: false,
      enableHiding: false,
      meta: { className: 'w-10 pr-0', label: 'Select' },
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select row ${row.index + 1}`}
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const sorting: SortingState = state.sorting;

  const table = useReactTable<TData>({
    data,
    columns: allColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
    enableSortingRemoval: true,
    sortDescFirst: false,
    enableRowSelection: selectable,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: state.setSorting,
    onColumnVisibilityChange: onVisibilityChange,
    onRowSelectionChange: setRowSelection,
  });

  // Remember row objects by id so selections survive page changes.
  for (const row of data) rowCache.current.set(getRowId(row), row);
  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedRows = selectedIds.flatMap((sid) => {
    const r = rowCache.current.get(sid);
    return r ? [r] : [];
  });
  const clearSelection = React.useCallback(() => setRowSelection({}), []);

  const rows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const showSkeleton = loading && data.length === 0;
  const showError = Boolean(error) && data.length === 0;
  const rowHeight = density === 'compact' ? 'h-9' : 'h-12';
  const cellPad = density === 'compact' ? 'py-1.5' : 'py-2.5';

  const focusRow = (index: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`tr[data-row-index="${index}"]`);
    if (el) {
      setFocusIndex(index);
      el.focus();
    }
  };

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, index: number, row: TData) => {
    const onRow = e.target === e.currentTarget;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(Math.min(rows.length - 1, index + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(Math.max(0, index - 1));
        break;
      case 'Home':
        if (onRow) {
          e.preventDefault();
          focusRow(0);
        }
        break;
      case 'End':
        if (onRow) {
          e.preventDefault();
          focusRow(rows.length - 1);
        }
        break;
      case 'Enter':
        if (onRow && onRowClick) {
          e.preventDefault();
          onRowClick(row);
        }
        break;
      case ' ':
        if (onRow) {
          e.preventDefault();
          if (selectable) rows[index]?.toggleSelected();
          else if (onRowClick) onRowClick(row);
        }
        break;
      case 'Escape':
        if (selectedIds.length > 0) {
          e.preventDefault();
          clearSelection();
        }
        break;
      default:
    }
  };

  const hideableColumns = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const noun1 = state.hasFilters ? `matching ${noun.plural}` : noun.plural;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-1.5">
          {toolbarActions}
          <div role="group" aria-label="Row density" className="flex items-center rounded-md border bg-card p-0.5 shadow-xs">
            <DensityButton active={density === 'comfortable'} onClick={() => setDensity('comfortable')} label="Comfortable rows" icon={<Rows3 />} />
            <DensityButton active={density === 'compact'} onClick={() => setDensity('compact')} label="Compact rows" icon={<Rows4 />} />
          </div>
          {hideableColumns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Columns3 aria-hidden="true" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideableColumns.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(v === true)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {col.columnDef.meta?.label ?? (typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-hidden rounded-lg border bg-card shadow-sm">
        {fetching && !showSkeleton && (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15" role="progressbar" aria-label="Refreshing">
            <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[table-progress_1.1s_ease-in-out_infinite]" />
          </div>
        )}
        <div className="overflow-auto" style={{ maxHeight }} tabIndex={-1}>
          <table
            className="w-full border-separate border-spacing-0 text-sm"
            aria-busy={loading || fetching}
            aria-rowcount={total}
          >
            <caption className="sr-only">{caption}</caption>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const canSort = header.column.getCanSort();
                    const dir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : canSort ? 'none' : undefined}
                        className={cn(
                          'sticky top-0 z-10 h-10 whitespace-nowrap border-b bg-muted px-4 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.className,
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              '-mx-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 uppercase tracking-wide transition-colors hover:bg-accent hover:text-foreground',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              dir && 'text-foreground',
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {dir === 'asc' ? (
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            ) : dir === 'desc' ? (
                              <ArrowDown className="size-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                            )}
                            <span className="sr-only">
                              {dir === 'asc' ? ', sorted ascending' : dir === 'desc' ? ', sorted descending' : ', sortable'}
                            </span>
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody ref={bodyRef} className={cn('transition-opacity duration-150', fetching && !showSkeleton && 'opacity-60')}>
              {showSkeleton &&
                Array.from({ length: Math.min(state.pageSize, 8) }, (_, i) => (
                  <tr key={`sk-${i}`} className={rowHeight}>
                    {table.getVisibleLeafColumns().map((col, c) => (
                      <td key={col.id} className={cn('border-b px-4', cellPad, col.columnDef.meta?.className)}>
                        <Skeleton className={cn('h-4', col.id === 'select' ? 'size-4' : c % 3 === 0 ? 'w-3/4' : c % 3 === 1 ? 'w-1/2' : 'w-2/3')} />
                      </td>
                    ))}
                  </tr>
                ))}

              {!showSkeleton && showError && (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    <ErrorState error={error} onRetry={onRetry} retrying={fetching} bare />
                  </td>
                </tr>
              )}

              {!showSkeleton && !showError && rows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    {state.hasFilters ? (
                      <EmptyState
                        bare
                        icon={<SearchX />}
                        title={`No ${noun.plural} match your filters`}
                        description="Try a different search term or clear the filters."
                        action={
                          <Button variant="secondary" size="sm" onClick={state.resetFilters}>
                            Clear filters
                          </Button>
                        }
                      />
                    ) : (
                      (emptyState ?? <EmptyState bare title={`No ${noun.plural} yet`} />)
                    )}
                  </td>
                </tr>
              )}

              {!showSkeleton &&
                !showError &&
                rows.map((row, index) => {
                  const clickable = Boolean(onRowClick);
                  return (
                    <tr
                      key={row.id}
                      data-row-index={index}
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      tabIndex={index === Math.min(focusIndex, rows.length - 1) ? 0 : -1}
                      onFocus={(e) => {
                        if (e.target === e.currentTarget) setFocusIndex(index);
                      }}
                      onKeyDown={(e) => onRowKeyDown(e, index, row.original)}
                      onClick={clickable ? () => onRowClick?.(row.original) : undefined}
                      aria-selected={selectable ? row.getIsSelected() : undefined}
                      className={cn(
                        'group/row outline-none transition-colors duration-150',
                        rowHeight,
                        clickable && 'cursor-pointer',
                        'hover:bg-muted/60 data-[state=selected]:bg-primary-subtle',
                        'focus-visible:bg-muted/80 focus-visible:shadow-[inset_0_0_0_2px_rgb(var(--ring))]',
                        rowClassName?.(row.original),
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        const title = meta?.cellTitle?.(row.original, cell.getValue());
                        return (
                          <td
                            key={cell.id}
                            title={title}
                            className={cn(
                              'border-b px-4 align-middle group-last/row:border-b-0',
                              cellPad,
                              meta?.align === 'right' && 'text-right tabular-nums',
                              meta?.align === 'center' && 'text-center',
                              meta?.className,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-2.5 text-[13px] text-muted-foreground">
          <p aria-live="polite" className="font-figure">
            {total === 0 ? (
              <>No {noun1}</>
            ) : (
              <>
                Showing <span className="font-medium text-foreground">{from.toLocaleString()}–{to.toLocaleString()}</span> of{' '}
                <span className="font-medium text-foreground">{total.toLocaleString()}</span> {total === 1 ? noun.singular : noun1}
              </>
            )}
          </p>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 sm:flex">
              <span id={`${id}-rpp`}>Rows per page</span>
              <Select value={String(state.pageSize)} onValueChange={(v) => state.setPageSize(Number(v))}>
                <SelectTrigger aria-labelledby={`${id}-rpp`} className="h-8 w-[4.5rem] px-2.5 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...pageSizeOptions, state.pageSize])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <span className="font-figure" aria-live="polite">
              Page <span className="font-medium text-foreground">{state.page}</span> of {pageCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton label="First page" icon={<ChevronsLeft />} size="icon-sm" disabled={state.page <= 1} onClick={() => state.setPage(1)} />
              <IconButton label="Previous page" icon={<ChevronLeft />} size="icon-sm" disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)} />
              <IconButton label="Next page" icon={<ChevronRight />} size="icon-sm" disabled={state.page >= pageCount} onClick={() => state.setPage(state.page + 1)} />
              <IconButton label="Last page" icon={<ChevronsRight />} size="icon-sm" disabled={state.page >= pageCount} onClick={() => state.setPage(pageCount)} />
            </div>
          </div>
        </div>
      </div>

      {selectable && selectedIds.length > 0 && bulkActions &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
            <div
              role="region"
              aria-label="Bulk actions"
              className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover py-2 pl-4 pr-2 shadow-pop animate-in fade-in-0 slide-in-from-bottom-3 duration-200"
            >
              <p className="font-figure text-sm font-medium" aria-live="polite">
                {selectedIds.length.toLocaleString()} selected
              </p>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1.5">{bulkActions({ rows: selectedRows, ids: selectedIds, clear: clearSelection })}</div>
              <IconButton label="Clear selection" icon={<X />} size="icon-sm" onClick={clearSelection} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function DensityButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <IconButton
      label={label}
      icon={icon}
      size="icon-sm"
      variant={active ? 'subtle' : 'ghost'}
      aria-pressed={active}
      onClick={onClick}
      className={cn('size-7', active && 'text-foreground')}
    />
  );
}

