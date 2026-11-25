import { endpoints, zEmployeeBiometrics } from '@nacta/shared';
import type { EmployeeBiometrics, PhotoUploadOptions, RemoteEnrollInput } from '@nacta/shared';
import { api, putMultipart } from '../api';

/** GET /employees/:id/biometrics */
export const getEmployeeBiometrics = (id: number, signal?: AbortSignal) =>
  api.get<EmployeeBiometrics>(endpoints.employeeBiometrics(id), { signal, schema: zEmployeeBiometrics });

/** PUT /employees/:id/photo (multipart "photo") -> EmployeeBiometrics */
export const uploadEmployeePhoto = (id: number, photo: Blob, opts: PhotoUploadOptions = {}) => {
  const syncToDevices = opts.syncToDevices !== false && opts.syncToDevices !== 'false' && opts.syncToDevices !== '0';
  const createFace = opts.createFace === true || opts.createFace === 'true' || opts.createFace === '1';
  const form = new FormData();
  form.append('photo', photo, 'photo.jpg');
  form.append('syncToDevices', String(syncToDevices));
  form.append('createFace', String(createFace));
  return putMultipart<EmployeeBiometrics>(endpoints.employeePhoto(id), form, {
    query: { syncToDevices, createFace },
    schema: zEmployeeBiometrics,
  });
};

/** DELETE /employees/:id/photo -> 204 (app copy only) */
export const deleteEmployeePhoto = (id: number) => api.delete(endpoints.employeePhoto(id));

/** POST /employees/:id/enroll -> 202 { commandId } */
export const enrollOnDevice = (id: number, input: RemoteEnrollInput) =>
  api.post<{ commandId: number }>(endpoints.employeeEnroll(id), input);

/** DELETE /employees/:id/biometrics/:templateId?fromDevices=true -> 204 */
export const deleteBiometricTemplate = (id: number, templateId: number, opts: { fromDevices?: boolean } = {}) =>
  api.delete(endpoints.employeeBiometric(id, templateId), { query: { fromDevices: opts.fromDevices ?? true } });
