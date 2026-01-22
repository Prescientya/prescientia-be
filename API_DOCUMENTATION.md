# Prescientia Backend - CRUD API Documentation

Dokumentasi lengkap untuk semua endpoint CRUD yang telah dibuat untuk aplikasi Prescientia.

## Base URL
```
http://localhost:3000/api
```

## Headers
Semua request harus menggunakan header:
```
Content-Type: application/json
```

---

## 0. Authentication & Authorization

### Test Connection
```
GET /auth/test
Response:
{
  "message": "Backend telah terkoneksikan"
}
```

### Check Database Status
```
GET /auth/check-db
Response:
{
  "success": true,
  "data": {
    "users_count": 100,
    "students_count": 80,
    "sample_students": [...]
  }
}
```

### LOGIN Student (Siswa)
```
POST /auth/login/siswa
Body:
{
  "nisn": "0012345678",
  "password": "password123"
}

Response:
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "student_id": 1,
    "user_id": 5,
    "nis": "0012345678",
    "name": "Budi Santoso",
    "email": "budi@example.com",
    "gender": "L",
    "date_of_birth": "2008-05-15",
    "phone_number": "08123456789",
    "address": "Jalan Merdeka 123",
    "class_id": 1,
    "photo_profile": "https://...",
    "device_id": "device123",
    "wifi_mac": "00:00:00:00:00:00"
  }
}
```

### LOGIN Teacher (Guru)
```
POST /auth/login/guru
Body:
{
  "nip": "198605152015011001",
  "password": "password123"
}

Response:
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "teacher_id": 1,
    "user_id": 3,
    "nip": "198605152015011001",
    "name": "Ibu Siti Nurhaliza",
    "email": "siti@example.com",
    "gender": "P",
    "date_of_birth": "1986-05-15",
    "phone_number": "08987654321",
    "address": "Jalan Pendidikan 45",
    "department": "Matematika",
    "photo_profile": "https://...",
    "device_id": "device456",
    "wifi_mac": "00:00:00:00:00:01",
    "role": "guru"
  }
}
```

### LOGIN Admin
```
POST /auth/login/admin
Body:
{
  "email": "admin@example.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "admin_id": 1,
    "user_id": 1,
    "name": "Admin Sekolah",
    "email": "admin@example.com",
    "nip": "198701011990031001",
    "phone_number": "08111111111",
    "photo_profile": "https://...",
    "device_id": "device789",
    "wifi_mac": "00:00:00:00:00:02",
    "role": "admin"
  }
}
```

### LOGIN Petugas MBG
```
POST /auth/login/petugas
Body:
{
  "username": "petugas01",
  "password": "password123"
}

Response:
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "id": 1,
    "username": "petugas01",
    "role": "petugas_mbg"
  }
}
```

### LOGOUT (Semua Users)
```
POST /auth/logout
Body:
{
  "user_id": 1
}

Response:
{
  "success": true,
  "message": "Logout berhasil",
  "data": {
    "user_id": 1,
    "email": "admin@example.com",
    "role": "admin",
    "login_duration": 45.5
  }
}
```

**Notes:**
- Endpoint login untuk Siswa, Guru, Admin menggunakan field `user_id` untuk logout
- Endpoint login untuk Petugas MBG tidak perlu logout karena tidak terdaftar di tabel users
- `login_duration` dalam satuan menit (null jika belum ada history login)
- Password di-hash menggunakan bcrypt
- Akun harus aktif (is_active = true) untuk login
- History login otomatis tercatat setelah login berhasil

---

## 1. Users Management

### GET All Users
```
GET /users?page=1&limit=10&is_active=true
```

### GET User by ID
```
GET /users/:id
```

### CREATE User
```
POST /users (DISABLED)
Response:
{
  "success": false,
  "message": "Pembuatan akun Users secara langsung melalui API tidak diizinkan. Gunakan endpoint role-specific (mis. /students, /teachers)."
}
```

### UPDATE User
```
PATCH /users/:id
Body:
{
  "email": "newemail@example.com",
  "password": "newpassword",
  "device_id": "newdevice",
  "wifi_mac": "00:00:00:00:00:00",
  "is_active": false
}
```

### DELETE User (Soft Delete)
```
DELETE /users/:id
```

**Note:** Tidak dapat menghapus user yang terkait dengan akun Admin. Hanya superadmin yang dapat mengelola akun admin.

---

## 2. Admins

### GET All Admins
```
GET /admins?page=1&limit=10
```

### GET Admin by ID
```
GET /admins/:id
```

### UPDATE Admin
```
PATCH /admins/:id
Body:
{
  "name": "New Name",
  "nip": "654321",
  "phone_number": "08987654321",
  "photo_profile": "https://..."
}
```

**Note:** Endpoint DELETE untuk Admin telah dihilangkan. Akun Admin tidak dapat dihapus melalui API. Hanya superadmin yang dapat mengelola akun admin melalui database secara langsung.

---

## 3. Teachers

### GET All Teachers
```
GET /teachers?page=1&limit=10&department=IPA&name=John
```

### GET Teacher by ID
```
GET /teachers/:id
```

### CREATE Teacher
Note: Endpoint ini akan membuat record di tabel `users` dan tabel `teachers` sekaligus (transactional).
```
POST /teachers
Body:
{
  "email": "teacher@example.com",
  "password": "password123",
  "nip": "198505081910031001",
  "name": "John Doe",
  "gender": "L",
  "date_of_birth": "1985-05-08",
  "phone_number": "08123456789",
  "address": "Jl. Contoh No. 1",
  "department": "IPA",
  "photo_profile": "https://..."
}
```

### UPDATE Teacher
```
PATCH /teachers/:id
Body:
{
  "name": "Jane Doe",
  "gender": "P",
  "department": "IPS"
}
```

### DELETE Teacher (Soft Delete)
```
DELETE /teachers/:id
```

---

## 4. Classes

### GET All Classes
```
GET /classes?page=1&limit=10&class=10&major=IPA
```

### GET Class by ID
```
GET /classes/:id
```

### CREATE Class
```
POST /classes
Body:
{
  "class": 10,
  "major": "IPA",
  "homeroom_teacher_id": 1
}
```

### UPDATE Class
```
PATCH /classes/:id
Body:
{
  "class": 11,
  "major": "IPS",
  "homeroom_teacher_id": 2
}
```

### DELETE Class
```
DELETE /classes/:id
```

---

## 5. Students

### GET All Students
```
GET /students?page=1&limit=10&class_id=1&name=John
```

### GET Student by ID
```
GET /students/:id
```

### GET Student Profile (Lengkap)
Menampilkan data profil lengkap siswa yang sedang login. Endpoint ini digunakan untuk mengisi menu Profile di FE.

**Memerlukan JWT Token** dari login siswa.

```
GET /students/profile
Headers:
{
  "Authorization": "Bearer <JWT_TOKEN>"
}
```

**Penjelasan:**
- Endpoint ini **otomatis** menampilkan profil siswa yang sedang login (berdasarkan JWT token)
- Tidak perlu mengirimkan student_id di URL
- Data yang ditampilkan adalah biodata lengkap siswa yang login

**Response Success (200):**
```json
{
  "success": true,
  "message": "Data profil student berhasil diambil",
  "data": {
    "user": {
      "id": 5,
      "email": "budi@example.com",
      "email_verified_at": null,
      "device_id": "device123",
      "wifi_mac": "00:00:00:00:00:00",
      "is_active": true,
      "last_login_at": "2024-01-15T10:30:00",
      "created_at": "2024-01-01T08:00:00",
      "updated_at": "2024-01-15T10:30:00"
    },
    "student": {
      "id": 1,
      "nis": "0012345678",
      "name": "Budi Santoso",
      "gender": "L",
      "date_of_birth": "2008-05-15",
      "phone_number": "08123456789",
      "address": "Jalan Merdeka 123",
      "photo_profile": "https://...",
      "created_at": "2024-01-01T08:00:00",
      "updated_at": "2024-01-15T10:30:00"
    },
    "class": {
      "id": 1,
      "level": 10,
      "major": "IPA"
    }
  }
}
```

**Response Error (401 - Token tidak valid/kadaluarsa):**
```json
{
  "success": false,
  "message": "Token kadaluwarsa. Silakan login kembali."
}
```

**Response Error (404 - Profil tidak ditemukan):**
```json
{
  "success": false,
  "message": "Profil student tidak ditemukan"
}
```

### CREATE Student
Note: Endpoint ini akan membuat record di tabel `users` dan tabel `students` sekaligus (transactional).
```
POST /students
Body:
{
  "email": "student@example.com",
  "password": "password123",
  "nis": "20101001",
  "name": "John Doe",
  "gender": "L",
  "date_of_birth": "2004-05-01",
  "phone_number": "08123456789",
  "address": "Jl. Contoh No. 1",
  "class_id": 1,
  "photo_profile": "https://..."
}
```

### UPDATE Student
```
PATCH /students/:id
Body:
{
  "name": "Jane Doe",
  "class_id": 2
}
```

### DELETE Student (Soft Delete)
```
DELETE /students/:id
```

---

## 6. History Login

### GET All History Login
```
GET /history-login?page=1&limit=10&user_id=1&status=success&start_date=2024-01-01&end_date=2024-12-31
```

### GET History by ID
```
GET /history-login/:id
```

### CREATE History Login
```
POST /history-login
Body:
{
  "user_id": 1,
  "device_id": "device123",
  "wifi_mac": "00:00:00:00:00:00",
  "ip_address": "192.168.1.1",
  "login_at": "2024-01-15T10:30:00",
  "location": "Building A",
  "status": "success"
}
```

### UPDATE History Login (Logout)
```
PUT /history-login/:id
Body:
{
  "logout_at": "2024-01-15T15:30:00",
  "duration_minutes": 300
}
```

### DELETE History Login
```
DELETE /history-login/:id
```

---

## 7. Student Class Roles

### GET All Student Class Roles
```
GET /student-class-roles?page=1&limit=10&class_id=1&role=KM
```

### GET Student Class Role by ID
```
GET /student-class-roles/:id
```

### CREATE Student Class Role
```
POST /student-class-roles
Body:
{
  "class_id": 1,
  "student_id": 1,
  "role": "KM"
}
```
Note: role values: KM, WKM, Sekretaris

### UPDATE Student Class Role
```
PATCH /student-class-roles/:id
Body:
{
  "role": "WKM"
}
```

### DELETE Student Class Role
```
DELETE /student-class-roles/:id
```

---

## 8. Teacher Class Roles

### GET All Teacher Class Roles
```
GET /teacher-class-roles?page=1&limit=10&teacher_id=1&class_id=1&role=pengajar
```

### GET Teacher Class Role by ID
```
GET /teacher-class-roles/:id
```

### CREATE Teacher Class Role
```
POST /teacher-class-roles
Body:
{
  "teacher_id": 1,
  "class_id": 1,
  "role": "pengajar"
}
```
Note: role values: pengajar, wali_kelas

### UPDATE Teacher Class Role
```
PATCH /teacher-class-roles/:id
Body:
{
  "role": "wali_kelas"
}
```

### DELETE Teacher Class Role
```
DELETE /teacher-class-roles/:id
```

---

## 9. WiFi Networks

### GET All WiFi Networks
```
GET /wifi-networks?page=1&limit=10&ssid=SchoolWiFi
```

### GET WiFi Network by ID
```
GET /wifi-networks/:id
```

### CREATE WiFi Network
```
POST /wifi-networks
Body:
{
  "ssid": "SchoolWiFi",
  "bssid": "00:11:22:33:44:55",
  "ip_address": "192.168.1.1"
}
```

### UPDATE WiFi Network
```
PATCH /wifi-networks/:id
Body:
{
  "ssid": "NewWiFiName",
  "ip_address": "192.168.1.2"
}
```

### DELETE WiFi Network
```
DELETE /wifi-networks/:id
```

---

## 10. WiFi Presence Logs

### GET All WiFi Presence Logs
```
GET /wifi-presence-logs?page=1&limit=10&user_id=1&wifi_id=1&start_date=2024-01-01&end_date=2024-12-31
```

### GET WiFi Presence Log by ID
```
GET /wifi-presence-logs/:id
```

### CREATE WiFi Presence Log
```
POST /wifi-presence-logs
Body:
{
  "user_id": 1,
  "wifi_id": 1,
  "detected_at": "2024-01-15T10:30:00"
}
```

### UPDATE WiFi Presence Log
```
PATCH /wifi-presence-logs/:id
Body:
{
  "detected_at": "2024-01-15T11:00:00"
}
```

### DELETE WiFi Presence Log
```
DELETE /wifi-presence-logs/:id
```

---

## 11. School Calendar

### GET All School Calendar
```
GET /school-calendar?page=1&limit=10&year=2024&month=1&status=aktif
```

### GET School Calendar by ID
```
GET /school-calendar/:id
```

### CREATE School Calendar
```
POST /school-calendar
Body:
{
  "date": "2024-01-15",
  "status": "aktif"
}
```
Note: status values: aktif, libur

### UPDATE School Calendar
```
PATCH /school-calendar/:id
Body:
{
  "status": "libur"
}
```

### DELETE School Calendar
```
DELETE /school-calendar/:id
```

---

## 12. Student Attendances

### GET All Student Attendances
```
GET /student-attendances?page=1&limit=10&student_id=1&class_id=1&status=hadir
```

### GET Student Attendance by ID
```
GET /student-attendances/:id
```

### CREATE Student Attendance
```
POST /student-attendances
Body:
{
  "student_id": 1,
  "class_id": 1,
  "calendar_id": 1,
  "check_in_time": "2024-01-15T07:00:00",
  "check_out_time": "2024-01-15T14:30:00",
  "status": "hadir",
  "source": "digital_wifi"
}
```
Note: 
- status: hadir, sakit, izin, alpa, terlambat
- source: digital_wifi, guru_pengajar, wali_kelas, self_report, manual

### UPDATE Student Attendance
```
PATCH /student-attendances/:id
Body:
{
  "check_in_time": "2024-01-15T07:15:00",
  "status": "terlambat"
}
```

### DELETE Student Attendance
```
DELETE /student-attendances/:id
```

---

## 13. Teacher Attendances

### GET All Teacher Attendances
```
GET /teacher-attendances?page=1&limit=10&teacher_id=1&status=hadir
```

### GET Teacher Attendance by ID
```
GET /teacher-attendances/:id
```

### CREATE Teacher Attendance
```
POST /teacher-attendances
Body:
{
  "teacher_id": 1,
  "calendar_id": 1,
  "check_in_time": "2024-01-15T06:30:00",
  "check_out_time": "2024-01-15T14:30:00",
  "status": "hadir",
  "source": "digital_wifi"
}
```
Note:
- status: hadir, sakit, izin, dinas, alpa, terlambat
- source: digital_wifi, manual, self_report

### UPDATE Teacher Attendance
```
PATCH /teacher-attendances/:id
Body:
{
  "status": "dinas"
}
```

### DELETE Teacher Attendance
```
DELETE /teacher-attendances/:id
```

---

## 14. Attendance Details

### Student Attendance Details

#### GET All Student Attendance Details
```
GET /attendance-details?page=1&limit=10&attendance_id=1&reason=sakit
```

#### GET Student Attendance Detail by ID
```
GET /attendance-details/:id
```

#### CREATE Student Attendance Detail
```
POST /attendance-details
Body:
{
  "attendance_id": 1,
  "reason": "sakit",
  "description": "Panas tinggi",
  "evidence_url": "https://..."
}
```
Note: reason values: sakit, izin, alpa, terlambat

#### UPDATE Student Attendance Detail
```
PATCH /attendance-details/:id
Body:
{
  "reason": "izin",
  "description": "Ada keperluan keluarga"
}
```

#### DELETE Student Attendance Detail
```
DELETE /attendance-details/:id
```

### Teacher Attendance Details

#### GET All Teacher Attendance Details
```
GET /attendance-details/teacher?page=1&limit=10&attendance_id=1
```

#### CREATE Teacher Attendance Detail
```
POST /attendance-details/teacher
Body:
{
  "attendance_id": 1,
  "reason": "dinas",
  "description": "Rapat di dinas pendidikan",
  "evidence_url": "https://..."
}
```
Note: reason values: sakit, izin, dinas, alpa, terlambat

#### UPDATE Teacher Attendance Detail
```
PATCH /attendance-details/teacher/:id
Body:
{
  "reason": "izin",
  "description": "Ada keperluan mendadak",
  "evidence_url": "https://..."
}
```

#### DELETE Teacher Attendance Detail
```
DELETE /attendance-details/teacher/:id
```

---

## 15. Student Attendance Summary

### GET All Student Attendance Summary
```
GET /student-attendance-summary?page=1&limit=10
```

### GET Student Attendance Summary by ID
```
GET /student-attendance-summary/:id
```

### CREATE Student Attendance Summary
```
POST /student-attendance-summary
Body:
{
  "student_id": 1,
  "total_hadir": 100,
  "total_izin": 2,
  "total_sakit": 1,
  "total_alpha": 0
}
```

### UPDATE Student Attendance Summary
```
PATCH /student-attendance-summary/:id
Body:
{
  "total_hadir": 101,
  "total_sakit": 2
}
```

### DELETE Student Attendance Summary
```
DELETE /student-attendance-summary/:id
```

---

## 16. MBG System

### Petugas MBG

#### GET All Petugas MBG
```
GET /mbg/petugas?page=1&limit=10
```

#### GET Petugas MBG by ID
```
GET /mbg/petugas/:id
```

#### CREATE Petugas MBG
```
POST /mbg/petugas
Body:
{
  "username": "petugas1",
  "password": "password123"
}
```

#### UPDATE Petugas MBG
```
PATCH /mbg/petugas/:id
Body:
{
  "password": "newpassword"
}
```

#### DELETE Petugas MBG (Soft Delete)
```
DELETE /mbg/petugas/:id
```

### Piring MBG

#### GET All Piring MBG
```
GET /mbg/piring?page=1&limit=10
```

#### GET Piring MBG by ID
```
GET /mbg/piring/:id
```

#### CREATE Piring MBG
```
POST /mbg/piring
Body:
{
  "stok": 100,
  "tanggal_distribusi": "2024-01-15"
}
```

#### UPDATE Piring MBG
```
PATCH /mbg/piring/:id
Body:
{
  "stok": 95,
  "tanggal_distribusi": "2024-01-15"
}
```

#### DELETE Piring MBG
```
DELETE /mbg/piring/:id
```

### MBG Class Daily

#### GET All MBG Class Daily
```
GET /mbg/class-daily?page=1&limit=10&piring_mbg_id=1&class_id=1
```

#### GET MBG Class Daily by ID
```
GET /mbg/class-daily/:id
```

#### CREATE MBG Class Daily
```
POST /mbg/class-daily
Body:
{
  "piring_mbg_id": 1,
  "class_id": 1,
  "total_students": 30,
  "attended_students": 28,
  "returned_plates": 25,
  "class_code": "10-A",
  "student_representative": "John Doe"
}
```

#### UPDATE MBG Class Daily
```
PATCH /mbg/class-daily/:id
Body:
{
  "attended_students": 29,
  "returned_plates": 26
}
```

#### DELETE MBG Class Daily
```
DELETE /mbg/class-daily/:id
```

### MBG Teacher Excess

#### GET All MBG Teacher Excess
```
GET /mbg/teacher-excess?page=1&limit=10&piring_mbg_id=1&teacher_id=1
```

#### GET MBG Teacher Excess by ID
```
GET /mbg/teacher-excess/:id
```

#### CREATE MBG Teacher Excess
```
POST /mbg/teacher-excess
Body:
{
  "piring_mbg_id": 1,
  "teacher_id": 1,
  "quantity": 5,
  "location": "Ruang Guru",
  "notes": "Untuk guru tamu"
}
```

#### UPDATE MBG Teacher Excess
```
PATCH /mbg/teacher-excess/:id
Body:
{
  "quantity": 3,
  "notes": "Sisa dari kemarin"
}
```

#### DELETE MBG Teacher Excess
```
DELETE /mbg/teacher-excess/:id
```

---

## Response Format

Semua endpoint mengembalikan response dalam format JSON berikut:

### Success Response
```json
{
  "success": true,
  "message": "Data berhasil diambil",
  "data": { ... },
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

## HTTP Status Codes

- **200 OK**: Request berhasil
- **201 Created**: Resource berhasil dibuat
- **400 Bad Request**: Validasi input gagal
- **404 Not Found**: Resource tidak ditemukan
- **409 Conflict**: Duplikasi data
- **500 Internal Server Error**: Error dari server

---

## Notes

1. Semua endpoint CRUD (Create, Read, Update, Delete) telah diimplementasikan untuk setiap tabel
2. Validasi input dilakukan di setiap endpoint
3. Password di-hash menggunakan bcrypt sebelum disimpan
4. Soft delete digunakan untuk user, admin, teacher, dan student
5. Pagination didukung di semua GET endpoint dengan parameter `page` dan `limit`
6. Filter dan search didukung di endpoint tertentu
7. Semua relasi foreign key dijaga konsistensinya

