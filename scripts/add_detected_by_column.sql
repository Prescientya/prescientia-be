-- =====================================================
-- MIGRATION: Add detected_by column to wifi_presence_logs
-- Purpose: Track how Wi-Fi presence was detected (BSSID or SSID)
-- Run this SQL in your PostgreSQL database
-- =====================================================

-- Add detected_by column to wifi_presence_logs
ALTER TABLE wifi_presence_logs 
ADD COLUMN IF NOT EXISTS detected_by VARCHAR(10) DEFAULT 'BSSID';

-- Add comment for documentation
COMMENT ON COLUMN wifi_presence_logs.detected_by IS 'Detection method: BSSID (primary) or SSID (fallback)';

-- Update existing records to have default value
UPDATE wifi_presence_logs 
SET detected_by = 'BSSID' 
WHERE detected_by IS NULL;

-- Verify the change
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'wifi_presence_logs' 
ORDER BY ordinal_position;
