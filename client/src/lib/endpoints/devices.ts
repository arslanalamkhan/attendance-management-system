import { z } from 'zod';
import {
  endpoints,
  zDevice,
  zDeviceCommand,
  zDeviceUser,
  zImportResult,
  zPage,
  zQueued,
} from '@nacta/shared';
import type {
  CommandListQuery,
  Device,
  DeviceCommand,
  DeviceInput,
  DeviceUpdate,
  DeviceUser,
  DeviceUserListQuery,
  EnqueueCommandInput,
  ImportDeviceUsersInput,
  ImportResult,
  Page,
  Queued,
} from '@nacta/shared';
import { api } from '../api';

/** GET /devices -> Device[] */
export const listDevices = (signal?: AbortSignal) =>
  api.get<Device[]>(endpoints.devices(), { signal, schema: z.array(zDevice) });

/** POST /devices -> 201 Device */
export const createDevice = (input: DeviceInput) => api.post<Device>(endpoints.devices(), input, { schema: zDevice });

/** GET /devices/:id -> Device */
export const getDevice = (id: number, signal?: AbortSignal) =>
  api.get<Device>(endpoints.device(id), { signal, schema: zDevice });

/** PUT /devices/:id -> Device */
export const updateDevice = (id: number, input: DeviceUpdate) =>
  api.put<Device>(endpoints.device(id), input, { schema: zDevice });

/** DELETE /devices/:id -> 204 */
export const deleteDevice = (id: number) => api.delete(endpoints.device(id));

/** GET /devices/:id/commands -> Page<DeviceCommand> */
export const listDeviceCommands = (id: number, query?: CommandListQuery, signal?: AbortSignal) =>
  api.get<Page<DeviceCommand>>(endpoints.deviceCommands(id), { query, signal, schema: zPage(zDeviceCommand) });

/** POST /devices/:id/commands -> 201 DeviceCommand */
export const enqueueDeviceCommand = (id: number, input: EnqueueCommandInput) =>
  api.post<DeviceCommand>(endpoints.deviceCommands(id), input, { schema: zDeviceCommand });

/** GET /devices/:id/users -> Page<DeviceUser> */
export const listDeviceUsers = (id: number, query?: DeviceUserListQuery, signal?: AbortSignal) =>
  api.get<Page<DeviceUser>>(endpoints.deviceUsers(id), { query, signal, schema: zPage(zDeviceUser) });

/** POST /devices/:id/users/fetch -> Queued */
export const fetchDeviceUsers = (id: number) =>
  api.post<Queued>(endpoints.deviceUsersFetch(id), undefined, { schema: zQueued });

/** POST /devices/:id/users/import -> ImportResult */
export const importDeviceUsers = (id: number, input: ImportDeviceUsersInput = {}) =>
  api.post<ImportResult>(endpoints.deviceUsersImport(id), input, { schema: zImportResult });

/** DELETE /devices/:id/users/:pin -> Queued */
export const deleteDeviceUser = (id: number, pin: string) =>
  api.delete<Queued>(endpoints.deviceUser(id, pin), { schema: zQueued });
