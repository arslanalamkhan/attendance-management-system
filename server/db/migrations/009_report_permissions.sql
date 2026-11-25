-- Reports are now granted one by one (reports.<type>) instead of all together through attendance.view.
-- Keep today's access: every role that could open the reports (attendance.view) gets every report key.
-- The Super Admin can then take individual reports away per role. Downloading still needs attendance.export.
INSERT INTO role_permissions (role_id, permission)
SELECT rp.role_id, r.key
FROM role_permissions rp
CROSS JOIN (VALUES
  ('reports.daily'),
  ('reports.monthly_register'),
  ('reports.late_comers'),
  ('reports.absentees'),
  ('reports.wing_summary'),
  ('reports.time_card'),
  ('reports.leave'),
  ('reports.punch_log'),
  ('reports.attendance_export')
) AS r(key)
WHERE rp.permission = 'attendance.view'
ON CONFLICT DO NOTHING;
