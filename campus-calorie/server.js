const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;

const db = new Database('data/calorie.db');
db.pragma('journal_mode = WAL');

// ======================== 初始化数据库 ========================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    height REAL DEFAULT 170,
    weight REAL DEFAULT 65,
    age INTEGER DEFAULT 25,
    gender TEXT DEFAULT 'male',
    activity_level TEXT DEFAULT 'sedentary'
  );

  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    cal_per_gram REAL,
    is_set INTEGER DEFAULT 0,
    default_grams INTEGER,
    source TEXT DEFAULT 'canteen'
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    food_name TEXT,
    grams INTEGER,
    calories INTEGER,
    category TEXT,
    meal TEXT DEFAULT 'lunch',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER,
    food_id INTEGER,
    PRIMARY KEY (user_id, food_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (food_id) REFERENCES foods(id)
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    activity TEXT,
    calories_burned REAL,
    log_date DATE DEFAULT (date('now', 'localtime')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 兼容旧表添加列
try { db.exec('ALTER TABLE records ADD COLUMN meal TEXT DEFAULT "lunch"'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN height REAL DEFAULT 170'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN weight REAL DEFAULT 65'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 25'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN gender TEXT DEFAULT "male"'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN activity_level TEXT DEFAULT "sedentary"'); } catch (e) {}

// 插入默认食物（如果为空）
const foodCount = db.prepare('SELECT COUNT(*) AS cnt FROM foods').get().cnt;
if (foodCount === 0) {
  const insert = db.prepare('INSERT INTO foods (name, category, cal_per_gram, is_set, default_grams, source) VALUES (?,?,?,?,?,?)');
  const foods = [
    ['白米饭','starch',1.3,0,null,'canteen'],
    ['猪脚饭整份','meat',2.2,1,500,'canteen'],
    ['黄焖鸡米饭','meat',2.1,1,450,'canteen'],
    ['烤肉饭','meat',1.9,1,400,'canteen'],
    ['麻辣烫','mixed',2.0,1,350,'canteen'],
    ['番茄炒蛋','egg',1.7,0,null,'canteen'],
    ['宫保鸡丁','meat',1.8,0,null,'canteen'],
    ['麻婆豆腐','tofu',1.5,0,null,'canteen'],
    ['鱼香肉丝','meat',1.6,0,null,'canteen'],
    ['水煮青菜','veg',0.9,0,null,'canteen'],
    ['炒面','starch',1.4,0,null,'canteen'],
    ['馒头','starch',1.2,0,null,'canteen'],
    ['苹果','fruit',0.6,0,null,'canteen'],
    ['香蕉','fruit',0.9,0,null,'canteen'],
    ['纯牛奶','milk',0.6,0,null,'canteen'],
    ['爱因斯坦极简餐','mixed',350,1,0,'celebrity'],
    ['奥巴马健身餐','mixed',520,1,0,'celebrity'],
    ['村上春树长跑者食谱','mixed',600,1,0,'celebrity'],
    ['希特勒素食餐','mixed',480,1,0,'celebrity'],
    ['墨索里尼大蒜沙拉','mixed',420,1,0,'celebrity'],
    ['C罗高蛋白餐','meat',550,1,0,'celebrity'],
    ['梅西地中海餐','mixed',620,1,0,'celebrity'],
    ['詹姆斯低碳水餐','mixed',580,1,0,'celebrity'],
    ['科比极致控脂餐','mixed',510,1,0,'celebrity'],
    ['马斯克肉食餐','meat',750,1,0,'celebrity'],
    ['黄仁勋米线餐','mixed',560,1,0,'celebrity']
  ];
  const insertMany = db.transaction(() => foods.forEach(f => insert.run(...f)));
  insertMany();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======================== 工具函数：BMR / TDEE ========================
function calcBMR(user) {
  const { weight, height, age, gender } = user;
  if (!weight || !height || !age) return 1800;
  if (gender === 'male') return 10 * weight + 6.25 * height - 5 * age + 5;
  else return 10 * weight + 6.25 * height - 5 * age - 161;
}

const activityMultiplier = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

function calcTDEE(user) {
  const bmr = calcBMR(user);
  const factor = activityMultiplier[user.activity_level] || 1.2;
  return Math.round(bmr * factor);
}

// ======================== 认证 ========================
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) return res.status(409).json({ error: '用户名已存在' });
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run(username, hash);
  res.json({ user: { id: info.lastInsertRowid, username } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: '用户名或密码错误' });
  res.json({ user: { id: user.id, username: user.username } });
});

// ======================== 用户资料 ========================
app.get('/api/profile', (req, res) => {
  const userId = req.query.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const bmr = calcBMR(user);
  const tdee = calcTDEE(user);
  res.json({
    height: user.height,
    weight: user.weight,
    age: user.age,
    gender: user.gender,
    activity_level: user.activity_level,
    bmr,
    tdee
  });
});

app.put('/api/profile', (req, res) => {
  const { userId, height, weight, age, gender, activity_level } = req.body;
  db.prepare('UPDATE users SET height=?, weight=?, age=?, gender=?, activity_level=? WHERE id=?')
    .run(height, weight, age, gender, activity_level, userId);
  res.json({ success: true });
});

// ======================== 活动热量 ========================
app.post('/api/activity', (req, res) => {
  const { userId, activity, caloriesBurned, date } = req.body;
  const logDate = date || new Date().toISOString().slice(0,10);
  db.prepare('INSERT INTO activity_logs (user_id, activity, calories_burned, log_date) VALUES (?,?,?,?)')
    .run(userId, activity, caloriesBurned, logDate);
  res.json({ success: true });
});

app.get('/api/activity', (req, res) => {
  const { userId, date } = req.query;
  const logs = db.prepare('SELECT * FROM activity_logs WHERE user_id = ? AND log_date = ?').all(userId, date);
  const total = logs.reduce((s, l) => s + l.calories_burned, 0);
  res.json({ logs, total });
});

// ======================== 食物列表（关键路由！） ========================
app.get('/api/foods', (req, res) => {
  const foods = db.prepare('SELECT * FROM foods').all();
  res.json(foods);
});

// ======================== 饮食记录 ========================
app.get('/api/records', (req, res) => {
  const { userId, date } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  let sql = 'SELECT * FROM records WHERE user_id = ?';
  const params = [userId];
  if (date) {
    sql += ' AND date(created_at) = ?';
    params.push(date);
  } else {
    sql += " AND date(created_at) = date('now','localtime')";
  }
  const records = db.prepare(sql).all(...params);
  res.json(records);
});

app.post('/api/records', (req, res) => {
  const { userId, foodName, grams, calories, category, meal, date } = req.body;
  if (!userId || !foodName || !grams || !calories) return res.status(400).json({ error: 'Missing fields' });
  const finalMeal = meal || 'lunch';
  const createdAt = date ? `${date} ${new Date().toTimeString().split(' ')[0]}` : new Date().toISOString().slice(0,19).replace('T',' ');
  const info = db.prepare('INSERT INTO records (user_id, food_name, grams, calories, category, meal, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, foodName, grams, calories, category || 'unknown', finalMeal, createdAt);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/records/:id', (req, res) => {
  db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/records/clear/:userId', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  db.prepare('DELETE FROM records WHERE user_id = ? AND date(created_at) = ?').run(req.params.userId, date);
  res.json({ success: true });
});

// ======================== 总摄入 ========================
app.get('/api/total', (req, res) => {
  const { userId, date } = req.query;
  const targetDate = date || new Date().toISOString().slice(0,10);
  const row = db.prepare('SELECT COALESCE(SUM(calories),0) AS total FROM records WHERE user_id = ? AND date(created_at) = ?').get(userId, targetDate);
  res.json({ total: row.total });
});

// ======================== 喜爱食物 ========================
app.get('/api/favorites', (req, res) => {
  const userId = req.query.userId;
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND food_id IN (SELECT id FROM foods WHERE category = 'starch')").run(userId);
  const favs = db.prepare('SELECT f.food_id, f2.* FROM favorites f JOIN foods f2 ON f.food_id = f2.id WHERE f.user_id = ?').all(userId);
  res.json(favs);
});
app.post('/api/favorites', (req, res) => {
  const { userId, foodId } = req.body;
  const food = db.prepare('SELECT category FROM foods WHERE id = ?').get(foodId);
  if (!food) return res.status(404).json({ error: '食物不存在' });
  if (food.category === 'starch') return res.status(400).json({ error: '主食不能设为喜爱' });
  try { db.prepare('INSERT INTO favorites (user_id, food_id) VALUES (?,?)').run(userId, foodId); res.json({ success: true }); }
  catch(e) { res.json({ success: false, error: '已存在' }); }
});
app.delete('/api/favorites', (req, res) => {
  const { userId, foodId } = req.body;
  db.prepare('DELETE FROM favorites WHERE user_id=? AND food_id=?').run(userId, foodId);
  res.json({ success: true });
});
app.post('/api/favorites/auto-detect', (req, res) => {
  const { userId } = req.body;
  const candidates = db.prepare(`
    SELECT r.food_name, f.id AS food_id, COUNT(*) AS cnt
    FROM records r JOIN foods f ON r.food_name = f.name
    WHERE r.user_id=? AND r.created_at >= datetime('now','-7 days') AND f.category != 'starch'
    GROUP BY f.id HAVING cnt>=4
  `).all(userId);
  const existing = db.prepare('SELECT food_id FROM favorites WHERE user_id=?').all(userId).map(e=>e.food_id);
  const newFavs = candidates.filter(c => !existing.includes(c.food_id));
  const insert = db.prepare('INSERT OR IGNORE INTO favorites (user_id,food_id) VALUES (?,?)');
  const added = [];
  newFavs.forEach(c => { insert.run(userId, c.food_id); added.push({ food_id:c.food_id, food_name:c.food_name, cnt:c.cnt }); });
  res.json({ added });
});

// ======================== 统计（周/月） ========================
app.get('/api/stats', (req, res) => {
  const { userId, period } = req.query;
  const today = new Date().toISOString().slice(0,10);
  let startDate;
  if (period === 'week') startDate = new Date(Date.now() - 6*86400000).toISOString().slice(0,10);
  else startDate = new Date(Date.now() - 29*86400000).toISOString().slice(0,10);
  const intakeRow = db.prepare('SELECT COALESCE(SUM(calories),0) AS total FROM records WHERE user_id=? AND date(created_at) BETWEEN ? AND ?').get(userId, startDate, today);
  const activityRow = db.prepare('SELECT COALESCE(SUM(calories_burned),0) AS total FROM activity_logs WHERE user_id=? AND log_date BETWEEN ? AND ?').get(userId, startDate, today);
  const days = period === 'week' ? 7 : 30;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const tdee = calcTDEE(user);
  const totalTDEE = tdee * days + activityRow.total;
  const surplus = totalTDEE - intakeRow.total;
  res.json({ totalIntake: intakeRow.total, totalActivity: activityRow.total, totalTDEE, surplus, days });
});

// ======================== 智能推荐（动态 TDEE 组合） ========================
app.get('/api/recommend', (req, res) => {
  const userId = req.query.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const tdee = calcTDEE(user);
  const today = new Date().toISOString().slice(0,10);
  const intakeRow = db.prepare('SELECT COALESCE(SUM(calories),0) AS total FROM records WHERE user_id=? AND date(created_at)=?').get(userId, today);
  const activityRow = db.prepare('SELECT COALESCE(SUM(calories_burned),0) AS total FROM activity_logs WHERE user_id=? AND log_date=?').get(userId, today);
  const totalBurned = tdee + activityRow.total;
  const totalCal = intakeRow.total;
  const remaining = totalBurned - totalCal;

  const categoryStats = db.prepare("SELECT category, SUM(calories) AS cal FROM records WHERE user_id=? AND date(created_at)=? GROUP BY category").all(userId, today);
  let topCategory=null, maxCalCat=0;
  categoryStats.forEach(s=>{ if(s.cal>maxCalCat){ maxCalCat=s.cal; topCategory=s.category; } });

  const meals = db.prepare("SELECT DISTINCT meal FROM records WHERE user_id=? AND date(created_at)=?").all(userId, today).map(r=>r.meal);
  let nextMeal='breakfast', todayComplete=false;
  if(meals.length===0) nextMeal='breakfast';
  else if(meals.length===1){
    if(meals[0]==='breakfast') nextMeal='lunch';
    else if(meals[0]==='lunch') nextMeal='dinner';
    else nextMeal='dinner';
  } else if(meals.length===2){
    if(meals.includes('breakfast')&&meals.includes('lunch')) nextMeal='dinner';
    else if(meals.includes('breakfast')&&meals.includes('dinner')) nextMeal='lunch';
    else if(meals.includes('lunch')&&meals.includes('dinner')) nextMeal='breakfast';
    else nextMeal='lunch';
  } else { nextMeal='dinner'; todayComplete=true; }

  db.prepare("DELETE FROM favorites WHERE user_id=? AND food_id IN (SELECT id FROM foods WHERE category='starch')").run(userId);
  const favFoods = db.prepare("SELECT f2.* FROM favorites f JOIN foods f2 ON f.food_id=f2.id WHERE f.user_id=? AND f2.is_set=0").all(userId);
  let allFoods = db.prepare('SELECT * FROM foods WHERE is_set=0').all();
  const isSuitable = (food, meal) => meal==='breakfast' && food.category==='meat' ? false : true;
  allFoods = allFoods.filter(f=>isSuitable(f, nextMeal));

  const getCal = (food, g=100)=>Math.round(food.cal_per_gram * g);
  const remainingCal = remaining;
  const minCal = Math.max(150, Math.min(remaining*0.6, 600));
  const starches = allFoods.filter(f=>f.category==='starch');
  const proteins = allFoods.filter(f=>['meat','egg','tofu'].includes(f.category));
  const veggies = allFoods.filter(f=>f.category==='veg');
  const fruits = allFoods.filter(f=>f.category==='fruit');
  const milks = allFoods.filter(f=>f.category==='milk');
  const others = allFoods.filter(f=>!['starch','meat','egg','tofu','veg','fruit','milk'].includes(f.category));

  let combos = [];
  for(let i=0;i<20;i++){
    let items=[], cals=0;
    if(starches.length){
      const f=starches[Math.floor(Math.random()*starches.length)];
      const cal=getCal(f); items.push({...f,grams:100,calories:cal}); cals+=cal;
    }
    const cnt=Math.floor(Math.random()*2)+1;
    for(let j=0;j<cnt;j++){
      const pool=[...proteins,...veggies,...others];
      if(!pool.length)break;
      const f=pool[Math.floor(Math.random()*pool.length)];
      const cal=getCal(f); items.push({...f,grams:100,calories:cal}); cals+=cal;
    }
    if(Math.random()>0.3 && (fruits.length||milks.length)){
      const pool=[...fruits,...milks];
      const f=pool[Math.floor(Math.random()*pool.length)];
      const cal=getCal(f); items.push({...f,grams:100,calories:cal}); cals+=cal;
    }
    if(cals>=minCal && cals<=remainingCal){
      const key=items.map(it=>it.id).sort().join(',');
      if(!combos.find(c=>c.key===key)) combos.push({key,items,totalCalories:cals});
    }
    if(combos.length>=3)break;
  }
  while(combos.length<3){
    let items=[], used=new Set();
    const shuffled=allFoods.sort(()=>Math.random()-0.5);
    for(const f of shuffled){
      if(used.has(f.category))continue;
      const cal=getCal(f); items.push({...f,grams:100,calories:cal}); used.add(f.category);
      if(items.length>=2)break;
    }
    let cals=items.reduce((s,i)=>s+i.calories,0);
    if(cals<=remainingCal && cals>=100){
      const key=items.map(i=>i.id).sort().join(',');
      if(!combos.find(c=>c.key===key)) combos.push({key,items,totalCalories:cals});
    }
  }
  const favIds=favFoods.map(f=>f.id);
  const result = combos.slice(0,3).map(c=>({
    key:c.key,
    items:c.items.map(i=>({name:i.name,grams:i.grams,calories:i.calories,category:i.category})),
    totalCalories:c.totalCalories,
    isFavorite:c.items.some(i=>favIds.includes(i.id))
  }));
  res.json({ recommendations:result, totalToday:totalCal, remaining, nextMeal, todayComplete, tdee, activityToday:activityRow.total });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));