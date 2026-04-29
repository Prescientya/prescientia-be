-- Add audit columns for manual attendance changes.
ALTER TABLE student_attendances
  ADD COLUMN IF NOT EXISTS updated_by_role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS updated_by_teacher_id BIGINT,
  ADD COLUMN IF NOT EXISTS change_reason TEXT;

-- Add FK for updated_by_teacher_id when missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_attendances_updated_by_teacher_id_fkey'
  ) THEN
    ALTER TABLE student_attendances
      ADD CONSTRAINT student_attendances_updated_by_teacher_id_fkey
      FOREIGN KEY (updated_by_teacher_id)
      REFERENCES teachers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Ensure updated_at auto-updates for every row update.
CREATE OR REPLACE FUNCTION set_student_attendances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_attendances_set_updated_at ON student_attendances;
CREATE TRIGGER trg_student_attendances_set_updated_at
BEFORE UPDATE ON student_attendances
FOR EACH ROW
EXECUTE FUNCTION set_student_attendances_updated_at();

-- Expand allowed source values with auto_system.
ALTER TABLE student_attendances
  DROP CONSTRAINT IF EXISTS student_attendances_source_check;

ALTER TABLE student_attendances
  ADD CONSTRAINT student_attendances_source_check
  CHECK (
    source IS NULL OR source IN (
      'digital_wifi',
      'guru_pengajar',
      'wali_kelas',
      'self_report',
      'manual',
      'auto_system'
    )
  );

ALTER TABLE teacher_attendances
  DROP CONSTRAINT IF EXISTS teacher_attendances_source_check;

ALTER TABLE teacher_attendances
  ADD CONSTRAINT teacher_attendances_source_check
  CHECK (
    source IS NULL OR source IN (
      'digital_wifi',
      'manual',
      'self_report',
      'auto_system'
    )
  );
