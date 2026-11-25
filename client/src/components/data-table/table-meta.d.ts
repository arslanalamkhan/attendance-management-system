import '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // Generics must match the library declaration; they are used by `cellTitle` below.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes for both <th> and <td> (width, hiding on small screens, ...). */
    className?: string;
    align?: 'left' | 'right' | 'center';
    /** Human label used in the column-visibility menu (defaults to a string header or the column id). */
    label?: string;
    /** Native tooltip for truncated cells. */
    cellTitle?: (row: TData, value: TValue) => string | undefined;
  }
}
