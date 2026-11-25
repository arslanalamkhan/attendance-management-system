import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryKey, UseQueryResult } from '@tanstack/react-query';
import type { SortingState, Updater } from '@tanstack/react-table';
import type { Page, PageQuery } from '@nacta/shared';

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

export interface UseDataTableStateOptions<K extends string> {
  /** Search-param names that carry filters, e.g. ['q', 'departmentId', 'isActive']. */
  filterKeys: readonly K[];
  defaultPageSize?: number;
  /** Applied when the URL has no `sort`. Not written to the URL. */
  defaultSort?: { id: string; desc: boolean };
  /** Namespace for the params when a page hosts more than one table, e.g. "users" -> users.page. */
  paramPrefix?: string;
}

/** Subset the <DataTable> needs; satisfied by every DataTableState. */
export interface DataTablePagingState {
  page: number;
  pageSize: number;
  sorting: SortingState;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSorting: (updater: Updater<SortingState>) => void;
  hasFilters: boolean;
  resetFilters: () => void;
}

export type TableFilters<K extends string> = Partial<Record<K, string>>;

/** What a list endpoint is called with: shared PageQuery plus string filters from the URL. */
export type TableQuery<K extends string> = PageQuery & TableFilters<K>;

export interface DataTableState<K extends string> extends DataTablePagingState {
  filters: TableFilters<K>;
  /** Set (or clear with '' / null) one filter. Resets to page 1. */
  setFilter: (key: K, value: string | null | undefined) => void;
  /** Merge several filters at once. Resets to page 1. */
  setFilters: (patch: Partial<Record<K, string | null | undefined>>) => void;
  /** Ready-to-send query: PageQuery + filters. */
  query: TableQuery<K>;
}

/**
 * Pagination, sort and filters that live in the URL (shareable, survives reload, back button works).
 * Pair with <DataTable> and `useDataTableQuery`.
 */
export function useDataTableState<K extends string>(options: UseDataTableStateOptions<K>): DataTableState<K> {
  const { filterKeys, defaultPageSize = 50, defaultSort, paramPrefix } = options;
  const [params, setParams] = useSearchParams();
  const p = useCallback((name: string) => (paramPrefix ? `${paramPrefix}.${name}` : name), [paramPrefix]);

  const page = Math.max(1, Number.parseInt(params.get(p('page')) ?? '', 10) || 1);
  const rawSize = Number.parseInt(params.get(p('pageSize')) ?? '', 10);
  const pageSize = rawSize >= 1 && rawSize <= 500 ? rawSize : defaultPageSize;

  const sortParam = params.get(p('sort'));
  const orderParam = params.get(p('order'));
  const sortId = sortParam ?? defaultSort?.id ?? null;
  const sortDesc = sortParam ? orderParam === 'desc' : (defaultSort?.desc ?? false);
  const sorting = useMemo<SortingState>(() => (sortId ? [{ id: sortId, desc: sortDesc }] : []), [sortId, sortDesc]);

  const filterKeyList = filterKeys.join('|');
  const filters = useMemo(() => {
    const out: TableFilters<K> = {};
    for (const k of filterKeys) {
      const v = params.get(p(k));
      if (v !== null && v !== '') out[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, filterKeyList, p]);

  const mutate = useCallback(
    (fn: (next: URLSearchParams) => void, opts: { resetPage?: boolean; push?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          fn(next);
          if (opts.resetPage) next.delete(p('page'));
          return next;
        },
        { replace: !opts.push },
      );
    },
    [setParams, p],
  );

  const setPage = useCallback(
    (n: number) =>
      mutate(
        (next) => {
          if (n <= 1) next.delete(p('page'));
          else next.set(p('page'), String(n));
        },
        { push: true },
      ),
    [mutate, p],
  );

  const setPageSize = useCallback(
    (size: number) =>
      mutate(
        (next) => {
          if (size === defaultPageSize) next.delete(p('pageSize'));
          else next.set(p('pageSize'), String(size));
        },
        { resetPage: true },
      ),
    [mutate, p, defaultPageSize],
  );

  const setSorting = useCallback(
    (updater: Updater<SortingState>) => {
      const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
      const first = nextSorting[0];
      mutate(
        (next) => {
          if (!first) {
            next.delete(p('sort'));
            next.delete(p('order'));
          } else {
            next.set(p('sort'), first.id);
            next.set(p('order'), first.desc ? 'desc' : 'asc');
          }
        },
        { resetPage: true },
      );
    },
    [mutate, p, sorting],
  );

  const setFilters = useCallback(
    (patch: Partial<Record<K, string | null | undefined>>) =>
      mutate(
        (next) => {
          for (const [k, v] of Object.entries(patch) as [K, string | null | undefined][]) {
            if (v === null || v === undefined || v === '') next.delete(p(k));
            else next.set(p(k), v);
          }
        },
        { resetPage: true },
      ),
    [mutate, p],
  );

  const setFilter = useCallback(
    (key: K, value: string | null | undefined) => setFilters({ [key]: value } as Partial<Record<K, string | null | undefined>>),
    [setFilters],
  );

  const hasFilters = Object.keys(filters).length > 0;
  const resetFilters = useCallback(
    () =>
      mutate(
        (next) => {
          for (const k of filterKeys) next.delete(p(k));
        },
        { resetPage: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutate, p, filterKeyList],
  );

  const query = useMemo<TableQuery<K>>(() => {
    const q: PageQuery & TableFilters<K> = { page, pageSize, ...filters };
    const first = sorting[0];
    if (first) {
      q.sort = first.id;
      q.order = first.desc ? 'desc' : 'asc';
    }
    return q;
  }, [page, pageSize, sorting, filters]);

  return { page, pageSize, sorting, filters, setPage, setPageSize, setSorting, setFilter, setFilters, hasFilters, resetFilters, query };
}

export interface UseDataTableQueryOptions<T, K extends string> {
  state: DataTableState<K>;
  /** Build the cache key (use the qk factory). */
  queryKey: (query: TableQuery<K>) => QueryKey;
  /** Convert the table query into the endpoint call. */
  fetcher: (query: TableQuery<K>, signal: AbortSignal) => Promise<Page<T>>;
  enabled?: boolean;
  refetchInterval?: number;
}

/**
 * Server-driven page of rows. Keeps the previous page on screen while the next loads
 * (no flicker), and snaps back if the URL asks for a page past the end.
 */
export function useDataTableQuery<T, K extends string>(
  options: UseDataTableQueryOptions<T, K>,
): UseQueryResult<Page<T>> {
  const { state, queryKey, fetcher, enabled, refetchInterval } = options;
  const result = useQuery<Page<T>>({
    queryKey: queryKey(state.query),
    queryFn: ({ signal }) => fetcher(state.query, signal),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval,
  });

  const total = result.data?.total;
  const { page, pageSize, setPage } = state;
  useEffect(() => {
    if (total === undefined || result.isPlaceholderData) return;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [total, page, pageSize, setPage, result.isPlaceholderData]);

  return result;
}
