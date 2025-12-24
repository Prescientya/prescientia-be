-- Sample data untuk testing
-- Jalankan setelah schema.sql berhasil dibuat

-- Insert sample classes
INSERT INTO classes (name, grade) VALUES
('X IPA 1', '10'),
('X IPA 2', '10'),
('XI IPA 1', '11');

-- Insert sample users
-- Password untuk semua user: "password123"
-- Hash bcrypt: $2b$10$rKj5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL
INSERT INTO users (email, password, is_active) VALUES
('student1@prescientia.com', '$2b$10$rKj5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL', true),
('student2@prescientia.com', '$2b$10$rKj5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL', true),
('student3@prescientia.com', '$2b$10$rKj5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL5YQZ5YwZeX5YwZ5vX3qL', true);

-- Insert sample students
INSERT INTO students (user_id, nis, name, gender, date_of_birth, phone_number, address, class_id) VALUES
(1, '123456', 'Ahmad Rizki', 'male', '2005-03-15', '081234567890', 'Jakarta', 1),
(2, '123457', 'Siti Nurhaliza', 'female', '2005-06-20', '081234567891', 'Bandung', 1),
(3, '123458', 'Budi Santoso', 'male', '2005-09-10', '081234567892', 'Surabaya', 2);

-- Verifikasi data
SELECT 
  s.nis,
  s.name,
  u.email,
  c.name as class_name
FROM students s
JOIN users u ON s.user_id = u.id
LEFT JOIN classes c ON s.class_id = c.id;

-- NOTES:
-- Default password untuk semua user: "password123"
-- Gunakan NISN dan password di atas untuk testing login
-- 
-- Test login dengan:
-- NISN: 123456, Password: password123
