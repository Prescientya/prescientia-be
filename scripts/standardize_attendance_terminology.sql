-- Standardize status terminology:
-- - Use 'alpa' instead of 'alpha'
-- - Use approval statuses: pending, approved, rejected

UPDATE student_attendances
SET status = 'alpa'
WHERE LOWER(status) = 'alpha';

UPDATE student_attendance_details
SET status = 'alpa'
WHERE LOWER(status) = 'alpha';

UPDATE attendance_status_changes
SET old_status = 'alpa'
WHERE LOWER(old_status) = 'alpha';

UPDATE attendance_status_changes
SET new_status = 'alpa'
WHERE LOWER(new_status) = 'alpha';

UPDATE student_attendance_details
SET approval_status = 'approved'
WHERE approval_status = 'confirmed';

ALTER TABLE absence_letters
  DROP CONSTRAINT IF EXISTS absence_letters_status_check;

ALTER TABLE absence_letters
  ADD CONSTRAINT absence_letters_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));
