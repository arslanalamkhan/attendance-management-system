/**
 * Route catalogue, relative to API_BASE ("/api/v1"). Server routers and client API wrappers
 * both follow this list. Response types are named after the zod schemas in this package.
 *
 * Lists marked Page<T> return { items, total, page, pageSize } and accept page, pageSize, sort, order.
 * Successful DELETEs return 204 with no body.
 */
export const endpoints = {
  health: () => `/health`, //                                  GET  -> Health
  overview: () => `/overview`, //                              GET  -> Overview

  devices: () => `/devices`, //                                GET  -> Device[] · POST DeviceInput -> 201 Device
  device: (id: number) => `/devices/${id}`, //                 GET  -> Device · PUT DeviceUpdate -> Device · DELETE
  deviceCommands: (id: number) => `/devices/${id}/commands`, //GET  -> Page<DeviceCommand> · POST EnqueueCommandInput -> 201 DeviceCommand
  deviceUsers: (id: number) => `/devices/${id}/users`, //      GET  -> Page<DeviceUser>
  deviceUsersFetch: (id: number) => `/devices/${id}/users/fetch`, //   POST -> Queued
  deviceUsersImport: (id: number) => `/devices/${id}/users/import`, // POST ImportDeviceUsersInput -> ImportResult
  deviceUser: (id: number, pin: string) => `/devices/${id}/users/${encodeURIComponent(pin)}`, // DELETE -> Queued

  // Wings replace departments (Phase D). /departments is removed.
  wings: () => `/wings`, //                                    GET  -> Wing[] (with sections) · POST WingInput -> 201 Wing
  wing: (id: number) => `/wings/${id}`, //                     PUT WingInput -> Wing · DELETE (employees keep, wing cleared)
  wingSections: (id: number) => `/wings/${id}/sections`, //    POST SectionInput -> 201 Section
  section: (id: number) => `/sections/${id}`, //               PUT SectionInput -> Section · DELETE

  employees: () => `/employees`, //                            GET  -> Page<Employee> · POST EmployeeInput -> 201 Employee
  employee: (id: number) => `/employees/${id}`, //             GET  -> EmployeeDetail · PUT EmployeeUpdate -> Employee · DELETE ?removeFromDevices
  employeesPush: () => `/employees/push`, //                   POST PushInput -> Queued
  employeeStatus: (id: number) => `/employees/${id}/status`, // POST StatusChangeInput -> EmployeeDetail
  employeePhoto: (id: number) => `/employees/${id}/photo`, //  GET image/jpeg · PUT multipart "photo" -> EmployeeBiometrics · DELETE
  employeeBiometrics: (id: number) => `/employees/${id}/biometrics`, // GET -> EmployeeBiometrics
  employeeBiometric: (id: number, templateId: number) => `/employees/${id}/biometrics/${templateId}`, // DELETE ?fromDevices
  employeeEnroll: (id: number) => `/employees/${id}/enroll`, // POST RemoteEnrollInput -> 202 { commandId }
  employeeFingerprints: (id: number) => `/employees/${id}/fingerprints`, // POST FingerprintCaptureInput -> 201 BiometricTemplate
  employeesExport: () => `/employees/export.xlsx`, //          GET  (list filters) -> .xlsx download
  employeesImportPreview: () => `/employees/import/preview`, // POST multipart "file" -> ImportPreview
  employeesImportCommit: () => `/employees/import/commit`, //   POST ImportCommitInput -> EmployeeImportResult

  // ---- Auth (public: login only; everything else requires a session) ----
  authLogin: () => `/auth/login`, //                           POST LoginInput -> SessionInfo (sets cookie)
  authLogout: () => `/auth/logout`, //                         POST -> 204
  authMe: () => `/auth/me`, //                                 GET  -> SessionInfo (401 when signed out)
  authChangePassword: () => `/auth/change-password`, //        POST ChangePasswordInput -> SessionInfo
  authSessions: () => `/auth/sessions`, //                     GET  -> SessionSummary[]
  authSession: (id: string) => `/auth/sessions/${id}`, //      DELETE -> 204 (own sessions only)
  authRevokeOthers: () => `/auth/sessions/revoke-others`, //   POST -> { revoked }

  // ---- Administration ----
  permissions: () => `/permissions`, //                        GET  -> catalogue (same as PERMISSIONS)
  roles: () => `/roles`, //                                    GET  -> Role[] · POST RoleInput -> 201 Role
  role: (id: number) => `/roles/${id}`, //                     PUT RoleInput -> Role · DELETE (409 if users assigned)
  users: () => `/users`, //                                    GET  -> Page<AppUser> · POST UserCreateInput -> 201 AppUser
  user: (id: number) => `/users/${id}`, //                     GET  -> AppUser · PUT UserUpdateInput -> AppUser · DELETE
  userResetPassword: (id: number) => `/users/${id}/reset-password`, // POST ResetPasswordInput -> 204
  userRevokeSessions: (id: number) => `/users/${id}/revoke-sessions`, // POST -> { revoked }
  userUnlock: (id: number) => `/users/${id}/unlock`, //        POST -> AppUser

  // ---- Audit (audit.view, except views which any signed-in user may post) ----
  audit: () => `/audit`, //                                    GET  -> Page<AuditEntry>
  auditEntry: (id: number) => `/audit/${id}`, //               GET  -> AuditEntry
  auditSummary: () => `/audit/summary`, //                     GET  ?from&to -> AuditSummary
  auditExport: () => `/audit/export`, //                       GET  same filters as /audit -> text/csv download (audited as audit.export)
  auditViews: () => `/audit/views`, //                         POST PageViewInput -> 204

  // ---- Dashboard & reports (Phase G) ----
  dashboardToday: () => `/dashboard/today`, //                 GET  -> TodaySummary (any signed-in user, own wings)
  dashboard: () => `/dashboard`, //                            GET  -> Dashboard (dashboard.view)
  report: (type: string) => `/reports/${type}`, //             GET  ReportParams -> ReportResult (attendance.view)
  reportExport: (type: string) => `/reports/${type}/export`, // GET  ?format=xlsx|pdf&ReportParams -> file (attendance.export, audited)

  // ---- Attendance rules (Phase F) ----
  attendanceDaily: () => `/attendance/daily`, //               GET  DailyQuery -> Page<AttendanceDay>          (attendance.view)
  attendanceDays: () => `/attendance/days`, //                 GET  employeeId&from&to -> AttendanceDay[]      (attendance.view)
  attendanceDaySummary: () => `/attendance/day-summary`, //    GET  from&to&wingId -> DaySummary               (attendance.view)
  attendanceCorrections: () => `/attendance/corrections`, //   GET  employeeId&from&to -> Correction[] · POST CorrectionInput -> 201 (attendance.correct)
  attendanceCorrection: (id: number) => `/attendance/corrections/${id}`, // DELETE (attendance.correct)
  attendanceRecompute: () => `/attendance/recompute`, //       POST {from,to} -> 202 (timings.manage)
  leaves: () => `/leaves`, //                                  GET  LeaveQuery -> Page<Leave> (leave.manage or attendance.view) · POST LeaveInput -> 201 Leave[] (leave.manage)
  leave: (id: number) => `/leaves/${id}`, //                   PUT LeaveUpdate -> Leave · DELETE (leave.manage)
  leaveTypes: () => `/leave-types`, //                         GET  -> LeaveType[] (any signed-in user with attendance.view, leave.manage or leave.configure) · POST (leave.configure)
  leaveType: (id: number) => `/leave-types/${id}`, //          PUT (leave.configure)
  holidays: () => `/holidays`, //                              GET  ?year -> Holiday[] (any of attendance.view, leave.manage, holidays.manage) · POST (holidays.manage)
  holiday: (id: number) => `/holidays/${id}`, //               PUT · DELETE (holidays.manage)
  timings: () => `/timings`, //                                GET  -> TimingProfile[] (timings.manage or attendance.view) · POST (timings.manage)
  timing: (id: number) => `/timings/${id}`, //                 PUT · DELETE (409 PROFILE_IN_USE) · POST /timings/:id/default
  timingAssignments: () => `/timing-assignments`, //           GET  -> TimingAssignment[] · POST TimingAssignmentInput (timings.manage)
  timingAssignment: (id: number) => `/timing-assignments/${id}`, // DELETE (timings.manage)

  attendance: () => `/attendance`, //                          GET  -> Page<AttendanceRecord>
  admsLog: () => `/adms-log`, //                               GET  -> Page<AdmsRequest>
} as const;
