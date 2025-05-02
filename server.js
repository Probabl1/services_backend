const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const Datastore = require('nedb');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 5001;

// Настройка CORS
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ?  ['https://gexpc.ru','https://95.163.222.63']
        : ['http://localhost:3000', 'http://localhost:63342'],
    credentials: true
};
app.use(express.json());
app.use(cors(corsOptions));

const session = require('express-session');
const bcrypt = require('bcryptjs');

app.use(session({
    resave: false,
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    saveUninitialized: false,
    cookie: { secure: false} // Для HTTPS установите true
}));

// Инициализация БД
const db = new Datastore({ filename: './db/services.db', autoload: true });

// Middleware для проверки аутентификации
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ message: 'Не авторизован' });
}

app.post('/create-payment', async (req, res) => {

    try {
        const { customer, description, itemsList } = req.body;

        const items = itemsList.map(item => ({
            description: item.name,
            quantity: Number(item.quantity).toFixed(3), // 1.000, 2.000 и т.д.
            amount: {
                value: Number(item.price).toFixed(2),     // "5500.00"
                currency: "RUB"
            },
            vat_code: 1,
            payment_subject: "service",
            payment_mode: "full_prepayment"
        }));
        console.log(items);
        const amount = itemsList.reduce((sum, item) => sum + Number(item.price*item.quantity), 0).toFixed(2)
        console.log(amount);
        const response = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: {
                value: amount,
                currency: 'RUB'
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: 'https://gexpc.ru'
            },
            description: description || 'Оплата',
            receipt: {
                "customer" : {
                    "full_name" : customer.full_name,
                    "phone" : customer.phone,
                },
                "type": "payment",
                "send": "true",
                "items": items
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.SHOP_ID}:${process.env.PAYMENT_KEY}`).toString('base64'),
                'Idempotence-Key': uuidv4()
            }
        });

        res.json({ confirmation_url: response.data.confirmation.confirmation_url });
    } catch (error) {
        console.error('Ошибка при создании платежа:', error.response?.data || error.message);
        res.status(500).json({ error: 'Ошибка при создании платежа' });
    }
});

app.post('/create-donation', async (req, res) => {

    try {
        const { customer, amount  } = process.env.NODE_ENV === 'production' ? req.body : {
            customer: {
                full_name: 'Вася пупкин',
                phone: '+79783373475'
            },
            amount: 500.00
        };
        console.log(customer, amount);
        const item = [{
            description: 'Пожертвование',
            quantity: 1.000,
            amount: {
                value: Number(amount).toFixed(2),     // "5500.00"
                currency: "RUB"
            },
            vat_code: 1,
            payment_subject: "service",
            payment_mode: "full_prepayment"
        }];
        const response = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: {
                value: amount,
                currency: 'RUB'
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: 'https://gexpc.ru'
            },
            description:  'Пожертвоание',
            receipt: {
                "customer" : {
                    "full_name" : customer.full_name,
                    "phone" : customer.phone,
                },
                "send": "true",
                "type": "payment",
                "items": item
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.SHOP_ID}:${process.env.PAYMENT_KEY}`).toString('base64'),
                'Idempotence-Key': uuidv4()
            }
        });

        res.json({ confirmation_url: response.data.confirmation.confirmation_url });
    } catch (error) {
        console.error('Ошибка при создании платежа:', error.response?.data || error.message);
        res.status(500).json({ error: 'Ошибка при создании платежа' });
    }
});
// Маршрут для входа
app.post('/admin/login', express.json(), async (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ message: 'Пароль обязателен' });
    }
console.log(process.env.ADMIN_PASSWORD_HASH);
    const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (isMatch) {
        req.session.isAuthenticated = true;
        return res.json({ success: true });
    }

    res.status(401).json({ message: 'Неверный пароль' });
});

// Маршрут для выхода
app.post('/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка выхода' });
        }
        res.json({ success: true });
    });
});

// Маршрут для проверки статуса аутентификации
app.get('/admin/check-auth', (req, res) => {
    res.json({ isAuthenticated: !!req.session.isAuthenticated });
});

// Защитите все админские маршруты middleware isAuthenticated
app.use('/admin', isAuthenticated);

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Фильтрация файлов
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Only JPEG/PNG allowed'), false);
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Создаем папку для загрузок, если ее нет
const fs = require('fs');
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}


// Разрешаем доступ к статическим файлам
app.use('/uploads', express.static('uploads'));

app.post('/services', upload.single('photo'), (req, res) => {
    try {
        // Парсим description из JSON-строки
        let description = [];
        if (req.body.description) {
            try {
                description = req.body.description;
                if (!Array.isArray(description)) {
                    description = [description];
                }
            } catch (e) {
                console.error('Ошибка парсинга description:', e);
                description = [];
            }
        }

        console.log('Полученные данные:', {
            name: req.body.name,
            price: req.body.price,
            description: description,
            file: req.file
        });

        if (!req.body.name || !req.body.price || description.length === 0) {
            return res.status(400).json({
                message: 'Заполните все обязательные поля'
            });
        }

        const newService = {
            name: req.body.name,
            description: description,
            price: req.body.price,
            photo: req.file ? '/uploads/' + req.file.filename : null,
            createdAt: new Date()
        };

        db.insert(newService, (err, service) => {
            if (err) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(500).json({ message: 'Ошибка сохранения' });
            }
            res.status(201).json(service);
        });

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});
// Получить список услуг
app.get('/services', (req, res) => {
    db.find({}, (err, docs) => {
        if (err) {
            res.status(500).json({ error: 'Ошибка получения данных' });
        } else {
            res.json(docs);
        }
    });
});

// Добавить услугу
app.post('/services', (req, res) => {
    const newService = req.body;
    db.insert(newService, (err, newDoc) => {
        if (err) {
            res.status(500).json({ error: 'Ошибка добавления' });
        } else {
            res.json(newDoc);
        }
    });
});

// Удалить услугу
app.delete('/services/:id', isAuthenticated,(req, res) => {
    db.findOne({ _id: req.params.id }, (err, service) => {
        if (err) return res.status(500).send(err);
        if (!service) return res.status(404).send('Услуга не найдена');

        // Удаляем связанное изображение
        if (service.photo) {
            const imagePath = path.join(__dirname, service.photo);

            fs.unlink(imagePath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    console.error('Ошибка удаления файла:', unlinkErr);
                    // Продолжаем удаление даже если файл не найден
                }

                // Удаляем запись из БД
                db.remove({ _id: req.params.id }, {}, (removeErr, numRemoved) => {
                    if (removeErr) return res.status(500).send(removeErr);
                    if (numRemoved === 0) return res.status(404).send('Услуга не найдена');

                    res.status(200).send('Услуга и изображение удалены');
                });
            });
        } else {
            // Если нет изображения, просто удаляем запись
            db.remove({ _id: req.params.id }, {}, (removeErr, numRemoved) => {
                if (removeErr) return res.status(500).send(removeErr);
                if (numRemoved === 0) return res.status(404).send('Услуга не найдена');

                res.status(200).send('Услуга удалена');
            });
        }
    });
});

// Периодическая очистка "мусорных" файлов
function cleanupOrphanedFiles() {
    fs.readdir(path.join(__dirname, 'uploads'), (err, files) => {
        if (err) {
            console.error('Ошибка чтения папки uploads:', err);
            return;
        }

        db.find({}, (dbErr, services) => {
            if (dbErr) {
                console.error('Ошибка чтения БД:', dbErr);
                return;
            }

            const usedFiles = services.map(s =>
                s.photo ? path.basename(s.photo) : null
            ).filter(Boolean);

            files.forEach(file => {
                if (!usedFiles.includes(file)) {
                    const filePath = path.join(__dirname, 'uploads', file);
                    fs.unlink(filePath, unlinkErr => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                            console.error('Ошибка удаления файла:', unlinkErr);
                        } else {
                            console.log('Удален orphaned файл:', file);
                        }
                    });
                }
            });
        });
    });
}

// Запускаем очистку при старте и затем каждые 24 часа
cleanupOrphanedFiles();
setInterval(cleanupOrphanedFiles, 24 * 60 * 60 * 1000);

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
