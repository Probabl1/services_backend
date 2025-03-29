const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync("chikpuk000", 11);
console.log("Хеш пароля:", hash);