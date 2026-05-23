require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const userRoutes = require('./src/routes/userRoutes');
const authRoutes = require('./src/routes/authRoutes');
const teacherRoutes = require('./src/routes/teacherRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const locationsRoutes = require('./src/routes/locationsRoutes');
const teacherFormRoutes = require('./src/routes/teacherFormRoutes');

const PORT = Number(process.env.PORT) || 8000;
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'ATS Platform API' });
});

app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/teacher-form', teacherFormRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/locations', locationsRoutes);

app.listen(PORT, () => {
  console.log(`server is running on ${PORT} `);
});
