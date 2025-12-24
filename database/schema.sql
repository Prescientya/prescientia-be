-- Contoh struktur database untuk Prescientia
-- Jalankan script ini di PostgreSQL untuk membuat tabel-tabel yang diperlukan

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    device_id VARCHAR(255),
    wifi_mac VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: students
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nis VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    gender VARCHAR(20),
    date_of_birth DATE,
    phone_number VARCHAR(20),
    address TEXT,
    class_id INTEGER,
    photo_profile VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: classes (optional)
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    grade VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key for class_id in students table
-- ALTER TABLE students ADD CONSTRAINT fk_students_class 
-- FOREIGN KEY (class_id) REFERENCES classes(id);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_students_nis ON students(nis);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
