const bcrypt = require('bcrypt');

/**
 * Script untuk membuat password hash
 * Jalankan: node scripts/hash-password.js
 */

const passwords = [
  'password123',
  'admin123',
  'student123'
];

async function generateHashes() {
  console.log('=== Password Hash Generator ===\n');
  
  for (const password of passwords) {
    const hash = await bcrypt.hash(password, 10);
    console.log(`Password: ${password}`);
    console.log(`Hash: ${hash}`);
    console.log('---');
  }
  
  console.log('\nCopy hash di atas dan gunakan untuk field password di database');
}

// Jika ingin hash password custom, uncomment baris di bawah
// const customPassword = process.argv[2];
// if (customPassword) {
//   bcrypt.hash(customPassword, 10).then(hash => {
//     console.log(`Password: ${customPassword}`);
//     console.log(`Hash: ${hash}`);
//   });
// } else {
//   generateHashes();
// }

generateHashes();
