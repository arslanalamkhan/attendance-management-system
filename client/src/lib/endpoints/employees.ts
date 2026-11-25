import {
  endpoints,
  zEmployee,
  zEmployeeDetail,
  zEmployeeImportResult,
  zImportPreview,
  zPage,
  zQueued,
} from '@nacta/shared';
import type {
  Employee,
  EmployeeDetail,
  EmployeeImportResult,
  EmployeeInput,
  EmployeeListQuery,
  EmployeeUpdate,
  ImportCommitInput,
  ImportPreview,
  Page,
  PushInput,
  Queued,
  StatusChangeInput,
} from '@nacta/shared';
import { api, downloadFile, postMultipart, toQueryString } from '../api';

/** GET /employees -> Page<Employee> */
export const listEmployees = (query?: EmployeeListQuery, signal?: AbortSignal) =>
  api.get<Page<Employee>>(endpoints.employees(), { query, signal, schema: zPage(zEmployee) });

/** POST /employees -> 201 Employee */
export const createEmployee = (input: EmployeeInput) =>
  api.post<Employee>(endpoints.employees(), input, { schema: zEmployee });

/** GET /employees/:id -> EmployeeDetail */
export const getEmployee = (id: number, signal?: AbortSignal) =>
  api.get<EmployeeDetail>(endpoints.employee(id), { signal, schema: zEmployeeDetail });

/** PUT /employees/:id -> Employee */
export const updateEmployee = (id: number, input: EmployeeUpdate) =>
  api.put<Employee>(endpoints.employee(id), input, { schema: zEmployee });

/** DELETE /employees/:id?removeFromDevices=true -> 204 */
export const deleteEmployee = (id: number, opts: { removeFromDevices?: boolean } = {}) =>
  api.delete(endpoints.employee(id), { query: { removeFromDevices: opts.removeFromDevices ?? false } });

/** POST /employees/push -> Queued */
export const pushEmployees = (input: PushInput) =>
  api.post<Queued>(endpoints.employeesPush(), input, { schema: zQueued });

/** POST /employees/:id/status -> EmployeeDetail. 409 NO_BIOMETRIC_BACKUP unless `force`. */
export const changeEmployeeStatus = (id: number, input: StatusChangeInput) =>
  api.post<EmployeeDetail>(endpoints.employeeStatus(id), input, { schema: zEmployeeDetail });

/** GET /employees/export.xlsx with the list filters (no paging) -> downloads the workbook. */
export const exportEmployees = (query?: Omit<EmployeeListQuery, 'page' | 'pageSize' | 'sort' | 'order'>) =>
  downloadFile(`${endpoints.employeesExport()}${toQueryString(query)}`, 'employees.xlsx');

/** POST /employees/import/preview (multipart "file") -> ImportPreview. Writes nothing. */
export const previewEmployeeImport = (file: File, signal?: AbortSignal) => {
  const form = new FormData();
  form.append('file', file);
  return postMultipart<ImportPreview>(endpoints.employeesImportPreview(), form, { signal, schema: zImportPreview });
};

/** POST /employees/import/commit -> EmployeeImportResult. 410 IMPORT_EXPIRED when the token is stale. */
export const commitEmployeeImport = (input: ImportCommitInput) =>
  api.post<EmployeeImportResult>(endpoints.employeesImportCommit(), input, { schema: zEmployeeImportResult });
