const fs = require('fs');

const content = fs.readFileSync('routes/auth.js', 'utf-8');
const lines = content.split('\n');

// Fix student login response
lines[638] = "        class_role: student.class_role || 'pelajar',";
lines[639] = "        first_login: student.first_login || false,";
lines[640] = "        token // JWT for client to use in Authorization header";
lines[641] = "      }";

// Find and fix teacher login response (should have teacher_roles and homeroom_classes before token)
// Looking for: "homeroom_classes: homeroomClassesValue,"
for (let i = 850; i < 900; i++) {
  if (lines[i] && lines[i].includes('homeroom_classes: homeroomClassesValue,')) {
    lines[i] = '        homeroom_classes: homeroomClassesValue,';
    lines[i+1] = '        first_login: teacher.first_login || false,';
    break;
  }
}

// Add first_login to admin login response too (before token)
for (let i = 1030; i < 1040; i++) {
  if (lines[i] && lines[i].includes("role: 'admin',")) {
    lines[i+1] = "        first_login: admin.first_login || false,";
    break;
  }
}

fs.writeFileSync('routes/auth.js', lines.join('\n'));
console.log('Fixed auth.js file');
