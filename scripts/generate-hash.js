const bcrypt = require('bcrypt');

// Password yang mau di-hash
const password = '123123';

bcrypt.hash(password, 10).then(hash => {
  console.log('=================================');
  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('=================================');
  console.log('\nJalankan SQL ini di PostgreSQL:');
  console.log(`UPDATE users SET password = '${hash}' WHERE id = 27;`);
  console.log('\nAtau untuk semua user dengan plain text password:');
  console.log(`UPDATE users SET password = '${hash}' WHERE email = 'ploo@gmail.com';`);
});
