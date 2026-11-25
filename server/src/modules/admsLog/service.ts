import type { z } from 'zod';
import type { AdmsRequest, Page, zAdmsLogQuery } from '@nacta/shared';
import { pool } from '../../db/pool';
import { byColumn, likeContains, limitOffset, orderBy, toPage, type SortConfig } from '../../lib/pagination';

type AdmsRow = {
  id: string;
  serial_number: string | null;
  method: string;
  path: string;
  query: string | null;
  body: string | null;
  response: string | null;
  remote_ip: string | null;
  created_at: Date;
};

const toAdmsRequest = (r: AdmsRow): AdmsRequest => ({
  id: Number(r.id),
  serialNumber: r.serial_number,
  method: r.method,
  path: r.path,
  query: r.query,
  body: r.body,
  response: r.response,
  remoteIp: r.remote_ip,
  createdAt: r.created_at.toISOString(),
});

const SORT: SortConfig = {
  keys: {
    id: byColumn('id'),
    createdAt: byColumn('created_at', 'id'),
    serialNumber: byColumn('serial_number', 'id', true),
    path: byColumn('path', 'id'),
  },
  defaultKey: 'id',
  defaultOrder: 'desc',
};

export async function list(q: z.output<typeof zAdmsLogQuery>): Promise<Page<AdmsRequest>> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (q.serialNumber) {
    vals.push(q.serialNumber);
    where.push(`serial_number = $${vals.length}`);
  }
  if (q.path) {
    vals.push(likeContains(q.path));
    where.push(`path ILIKE $${vals.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM adms_requests ${w}`, vals);
  const { limit, offset } = limitOffset(q);
  const { rows } = await pool.query<AdmsRow>(
    `SELECT id, serial_number, method, path, query, body, response, remote_ip, created_at
     FROM adms_requests ${w} ORDER BY ${orderBy(q, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return toPage(rows.map(toAdmsRequest), Number((total.rows[0] as { n: string }).n), q);
}
