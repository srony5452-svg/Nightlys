const express=require('express'), path=require('path'), bcrypt=require('bcryptjs'), session=require('express-session'), Database=require('better-sqlite3');
const app=express(), db=new Database('demotrade.db');
app.use(express.json()); app.use(session({secret:process.env.SESSION_SECRET||'change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,email TEXT UNIQUE,password TEXT,balance REAL DEFAULT 10000,admin INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY,user_id INTEGER,side TEXT,amount REAL,price REAL,created_at TEXT);`);
if(!db.prepare('SELECT 1 FROM users WHERE admin=1').get()){
 const hash=bcrypt.hashSync(process.env.ADMIN_PASSWORD||'admin123',10);
 db.prepare('INSERT INTO users(username,email,password,balance,admin) VALUES(?,?,?,?,1)').run('admin','admin@example.com',hash,100000);
}
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
function auth(req,res,next){if(!req.session.uid)return res.status(401).json({error:'Login required'});next()}
app.post('/api/register',(req,res)=>{let {username,email,password}=req.body||{}; if(!username||!email||!password||password.length<6)return res.status(400).json({error:'Username, email and 6+ character password required'}); try{let h=bcrypt.hashSync(password,10);let r=db.prepare('INSERT INTO users(username,email,password) VALUES(?,?,?)').run(username,email,h);req.session.uid=r.lastInsertRowid;res.json({ok:true})}catch(e){res.status(400).json({error:'Username or email already exists'})}});
app.post('/api/login',(req,res)=>{let u=db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email);if(!u||!bcrypt.compareSync(req.body.password,u.password))return res.status(401).json({error:'Invalid login'});req.session.uid=u.id;res.json({ok:true})});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,(req,res)=>{let u=db.prepare('SELECT id,username,email,balance,admin FROM users WHERE id=?').get(req.session.uid);let trades=db.prepare('SELECT side,amount,price,created_at FROM trades WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);res.json({user:u,trades})});
app.post('/api/trade',auth,(req,res)=>{let {side,amount,price}=req.body;amount=Number(amount);price=Number(price);if(!['buy','sell'].includes(side)||amount<=0||price<=0)return res.status(400).json({error:'Invalid trade'});let u=db.prepare('SELECT * FROM users WHERE id=?').get(req.session.uid);if(side==='buy'&&amount>u.balance)return res.status(400).json({error:'Insufficient demo balance'});let nb=u.balance+(side==='buy'?-amount:amount);db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb,u.id);db.prepare('INSERT INTO trades(user_id,side,amount,price,created_at) VALUES(?,?,?,?,?)').run(u.id,side,amount,price,new Date().toISOString());res.json({ok:true})});
app.get('/api/admin/users',auth,(req,res)=>{let u=db.prepare('SELECT admin FROM users WHERE id=?').get(req.session.uid);if(!u.admin)return res.status(403).json({error:'Admin only'});res.json(db.prepare('SELECT id,username,email,balance,admin FROM users ORDER BY id DESC').all())});
app.post('/api/admin/balance',auth,(req,res)=>{let a=db.prepare('SELECT admin FROM users WHERE id=?').get(req.session.uid);if(!a.admin)return res.status(403).json({error:'Admin only'});let id=Number(req.body.userId),balance=Number(req.body.balance);if(balance<0)return res.status(400).json({error:'Invalid balance'});db.prepare('UPDATE users SET balance=? WHERE id=?').run(balance,id);res.json({ok:true})});
app.listen(process.env.PORT||3000,()=>console.log('DemoTrade running'));
